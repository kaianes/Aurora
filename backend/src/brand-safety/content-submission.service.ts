import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { In, Repository } from 'typeorm';
import {
  Campaign,
  CampaignOpportunity,
  OpportunityStatus,
  ContentSubmission,
  ExtractionStatus,
  SafetyCheck,
  SafetyCheckStatus,
  SafetyRuleTrigger,
  SafetyRule,
} from '../database/entities';
import { AuditService } from '../audit/audit.service';
import { RulesetService } from './ruleset.service';
import { CreateContentSubmissionDto } from './dto/create-content-submission.dto';
import { SAFETY_CHECK_TIMEOUT_MINUTES } from './brand-safety.config';

interface ActorContext {
  ipAddress: string;
  userAgent: string;
}

export interface CheckStatusActor {
  isCreator: boolean;
  creatorId?: string;
  currentAccountId?: string;
}

const CHECK_UNAVAILABLE_MESSAGE =
  'A verificacao de seguranca da marca nao pode ser concluida a tempo. O conteudo permanece bloqueado para publicacao e foi enviado para revisao humana.';

@Injectable()
export class ContentSubmissionService {
  constructor(
    @InjectRepository(Campaign)
    private campaignRepo: Repository<Campaign>,
    @InjectRepository(CampaignOpportunity)
    private opportunityRepo: Repository<CampaignOpportunity>,
    @InjectRepository(ContentSubmission)
    private submissionRepo: Repository<ContentSubmission>,
    @InjectRepository(SafetyCheck)
    private checkRepo: Repository<SafetyCheck>,
    @InjectRepository(SafetyRuleTrigger)
    private triggerRepo: Repository<SafetyRuleTrigger>,
    @InjectRepository(SafetyRule)
    private ruleRepo: Repository<SafetyRule>,
    @InjectQueue('brand-safety')
    private brandSafetyQueue: Queue,
    private rulesetService: RulesetService,
    private auditService: AuditService,
  ) {}

  // ================= US-16: creator-portal intake =================

  async createSubmission(
    dto: CreateContentSubmissionDto,
    creatorId: string,
    actor: ActorContext,
  ) {
    if (!dto.caption_text || dto.caption_text.trim().length === 0) {
      throw new UnprocessableEntityException({
        error: {
          code: 'CAPTION_TEXT_REQUIRED',
          message: 'caption_text e obrigatorio e nao pode ser vazio.',
          details: {},
        },
      });
    }

    const campaign = await this.campaignRepo.findOne({ where: { id: dto.campaign_id } });
    if (!campaign) {
      throw new NotFoundException({
        error: { code: 'CAMPAIGN_NOT_FOUND', message: 'Campanha nao encontrada.', details: {} },
      });
    }

    // US-16's precondition: a creator may only submit content against a
    // campaign they hold an accepted opportunity on (section 3.3 of the E4
    // architecture doc).
    if (dto.opportunity_id) {
      const opportunity = await this.opportunityRepo.findOne({
        where: {
          id: dto.opportunity_id,
          campaignId: dto.campaign_id,
          creatorId,
          status: OpportunityStatus.ACCEPTED,
        },
      });
      if (!opportunity) {
        throw new NotFoundException({
          error: {
            code: 'OPPORTUNITY_NOT_FOUND',
            message: 'Nenhuma oportunidade aceita foi encontrada para este criador nesta campanha.',
            details: {},
          },
        });
      }
    }

    const hasDirectText = !!dto.on_screen_text || !!dto.audio_transcript;
    const extractionNeeded = !hasDirectText && !!dto.media_asset_url;
    const extractionStatus = extractionNeeded ? ExtractionStatus.PENDING : ExtractionStatus.NOT_REQUIRED;

    const submission = await this.submissionRepo.save(
      this.submissionRepo.create({
        campaignId: dto.campaign_id,
        creatorId,
        opportunityId: dto.opportunity_id || null,
        captionText: dto.caption_text,
        onScreenText: dto.on_screen_text || null,
        audioTranscript: dto.audio_transcript || null,
        mediaAssetUrl: dto.media_asset_url || null,
        extractionStatus,
      }),
    );

    const rulesetId = await this.rulesetService.resolveGoverningRulesetId(
      dto.campaign_id,
      campaign.accountId,
    );
    const timeoutAt = new Date(Date.now() + SAFETY_CHECK_TIMEOUT_MINUTES * 60_000);

    const check = await this.checkRepo.save(
      this.checkRepo.create({
        contentSubmissionId: submission.id,
        campaignId: dto.campaign_id,
        rulesetId,
        status: SafetyCheckStatus.PENDING,
        timeoutAt,
      }),
    );

    if (extractionNeeded) {
      await this.brandSafetyQueue.add('extract-content-channels', {
        contentSubmissionId: submission.id,
        safetyCheckId: check.id,
      });
    } else {
      await this.brandSafetyQueue.add('run-safety-check', {
        contentSubmissionId: submission.id,
        safetyCheckId: check.id,
      });
    }

    await this.auditService.log({
      actorUserId: null,
      targetAccountId: campaign.accountId,
      action: 'content_submission.created',
      metadata: { content_submission_id: submission.id, campaign_id: dto.campaign_id, creator_id: creatorId },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return {
      content_submission_id: submission.id,
      safety_check_id: check.id,
      status: check.status,
      poll_url: `/v1/safety/submissions/${submission.id}/check`,
    };
  }

  // ================= US-16 scenario 2 / ADR-0022: check-status polling =================

  async getCheckStatus(contentSubmissionId: string, actor: CheckStatusActor) {
    const submission = await this.submissionRepo.findOne({ where: { id: contentSubmissionId } });
    if (!submission) {
      throw new NotFoundException({
        error: { code: 'SUBMISSION_NOT_FOUND', message: 'Submissao nao encontrada.', details: {} },
      });
    }

    if (actor.isCreator) {
      // Own submissions only (section 3.3 of the E4 architecture doc). A
      // creator polling someone else's submission gets the same
      // not-found response a nonexistent id would, rather than a 403 that
      // confirms the id exists.
      if (submission.creatorId !== actor.creatorId) {
        throw new NotFoundException({
          error: { code: 'SUBMISSION_NOT_FOUND', message: 'Submissao nao encontrada.', details: {} },
        });
      }
    } else if (actor.currentAccountId) {
      const campaign = await this.campaignRepo.findOne({
        where: { id: submission.campaignId, accountId: actor.currentAccountId },
      });
      if (!campaign) {
        throw new NotFoundException({
          error: { code: 'SUBMISSION_NOT_FOUND', message: 'Submissao nao encontrada.', details: {} },
        });
      }
    } else {
      throw new ForbiddenException({
        error: { code: 'INSUFFICIENT_PRIVILEGES', message: 'Acesso nao autorizado.', details: {} },
      });
    }

    const check = await this.checkRepo.findOne({
      where: { contentSubmissionId },
      order: { requestedAt: 'DESC' },
    });
    if (!check) {
      throw new NotFoundException({
        error: { code: 'CHECK_NOT_FOUND', message: 'Nenhuma verificacao foi solicitada para esta submissao.', details: {} },
      });
    }

    return this.formatCheck(check);
  }

  async formatCheck(check: SafetyCheck) {
    const base: Record<string, any> = {
      id: check.id,
      status: check.status,
      requested_at: check.requestedAt.toISOString(),
    };

    if (check.status === SafetyCheckStatus.PENDING) {
      return base;
    }

    base.resolved_at = check.resolvedAt?.toISOString() || null;

    if (check.status === SafetyCheckStatus.PASSED) {
      base.tier_reached = check.tierReached;
      return base;
    }

    if (check.status === SafetyCheckStatus.FLAGGED) {
      base.tier_reached = check.tierReached;
      base.triggered_rules = await this.formatTriggers(check.id);
      return base;
    }

    // check_unavailable (ADR-0022): no rule citation, an honest system message.
    base.message = CHECK_UNAVAILABLE_MESSAGE;
    return base;
  }

  // Used by the record-publication HTTP wrapper (section 3.6 of the E4
  // architecture doc) to enforce tenant isolation at that boundary --
  // BrandSafetyGateService's own exported contract takes no accountId
  // parameter (it is the fixed interface a future E5 calls directly), so
  // this check belongs to the thin HTTP layer, not the gate service itself.
  async findSubmissionForAccountOrFail(contentSubmissionId: string, accountId: string): Promise<ContentSubmission> {
    const submission = await this.submissionRepo.findOne({ where: { id: contentSubmissionId } });
    if (!submission) {
      throw new NotFoundException({
        error: { code: 'SUBMISSION_NOT_FOUND', message: 'Submissao nao encontrada.', details: {} },
      });
    }
    const campaign = await this.campaignRepo.findOne({
      where: { id: submission.campaignId, accountId },
    });
    if (!campaign) {
      throw new NotFoundException({
        error: { code: 'SUBMISSION_NOT_FOUND', message: 'Submissao nao encontrada.', details: {} },
      });
    }
    return submission;
  }

  async formatTriggers(safetyCheckId: string) {
    const triggers = await this.triggerRepo.find({ where: { safetyCheckId } });
    const ruleIds = [...new Set(triggers.filter((t) => t.ruleId).map((t) => t.ruleId as string))];
    const rules = ruleIds.length > 0 ? await this.ruleRepo.find({ where: { id: In(ruleIds) } }) : [];
    const ruleById = new Map(rules.map((r) => [r.id, r]));

    return triggers.map((t) => ({
      rule_id: t.ruleId,
      rule_type: t.ruleId ? ruleById.get(t.ruleId)?.ruleType || null : null,
      channel: t.channel,
      matched_excerpt: t.matchedExcerpt,
    }));
  }
}
