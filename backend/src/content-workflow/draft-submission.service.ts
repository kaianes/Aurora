import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Campaign,
  CampaignState,
  CampaignOpportunity,
  OpportunityStatus,
  ContentSubmission,
  ContentReviewDecision,
  ContentReviewDecisionValue,
  Creator,
} from '../database/entities';
import { ContentSubmissionService } from '../brand-safety/content-submission.service';
import { BrandSafetyGateService } from '../brand-safety/brand-safety-gate.service';
import { CreateContentSubmissionDto } from '../brand-safety/dto/create-content-submission.dto';
import { DRAFT_REVIEW_SLA_HOURS } from './content-workflow.config';

interface ActorContext {
  ipAddress: string;
  userAgent: string;
}

// US-32a (accept a draft, retain every version) and US-32b (review deadline
// visibility), plus the read-side of US-33 (the stated reason attributed to
// the exact version it applies to). Builds on content_submission (ADR-0025)
// and calls ContentSubmissionService in-process (ADR-0032) -- this service
// owns only the validations specific to E5's own obligations (the
// opportunity, the campaign's state, and the resubmission precondition),
// never duplicating brand-safety's own intake logic.
@Injectable()
export class DraftSubmissionService {
  constructor(
    @InjectRepository(Campaign)
    private campaignRepo: Repository<Campaign>,
    @InjectRepository(CampaignOpportunity)
    private opportunityRepo: Repository<CampaignOpportunity>,
    @InjectRepository(ContentSubmission)
    private submissionRepo: Repository<ContentSubmission>,
    @InjectRepository(ContentReviewDecision)
    private decisionRepo: Repository<ContentReviewDecision>,
    @InjectRepository(Creator)
    private creatorRepo: Repository<Creator>,
    private contentSubmissionService: ContentSubmissionService,
    private gateService: BrandSafetyGateService,
  ) {}

  async createDraft(dto: CreateContentSubmissionDto, creatorId: string, actor: ActorContext) {
    // 1. the opportunity must be present and resolve to an accepted
    // campaign_opportunity for this creator on this campaign (US-32a scenario 3).
    if (!dto.opportunity_id) {
      throw new NotFoundException({
        error: {
          code: 'OPPORTUNITY_NOT_FOUND',
          message: 'Nenhuma oportunidade aceita foi encontrada para este criador nesta campanha.',
          details: {},
        },
      });
    }
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

    // 2. the campaign must currently be active (US-32a scenario 3).
    const campaign = await this.campaignRepo.findOne({ where: { id: dto.campaign_id } });
    if (!campaign || campaign.state !== CampaignState.ACTIVE) {
      throw new UnprocessableEntityException({
        error: {
          code: 'CAMPAIGN_NOT_ACTIVE',
          message: 'Esta campanha nao esta ativa no momento, portanto nao aceita novos envios.',
          details: { current_state: campaign?.state || null },
        },
      });
    }

    // 3. the version-lineage resubmission rule (ADR-0025, section 3.3).
    const latest = await this.submissionRepo.findOne({
      where: { opportunityId: dto.opportunity_id },
      order: { versionNumber: 'DESC' },
    });

    let supersedesSubmissionId: string | null = null;
    if (latest) {
      const decision = await this.decisionRepo.findOne({ where: { contentSubmissionId: latest.id } });
      if (!decision) {
        throw new ConflictException({
          error: {
            code: 'PENDING_REVIEW_IN_PROGRESS',
            message: 'A versao mais recente deste envio ainda esta aguardando revisao.',
            details: {},
          },
        });
      }
      if (decision.decision === ContentReviewDecisionValue.APPROVED) {
        throw new ConflictException({
          error: {
            code: 'ALREADY_APPROVED',
            message: 'Esta entrega ja foi aprovada e nao aceita novas versoes.',
            details: {},
          },
        });
      }
      supersedesSubmissionId = latest.id;
    }

    const reviewDeadlineAt = new Date(Date.now() + DRAFT_REVIEW_SLA_HOURS * 60 * 60 * 1000);

    // 4. the one in-process call into brand-safety's own intake logic
    // (ADR-0032) -- the audit entry for content_submission.created,
    // including version_number and supersedes_submission_id when present,
    // is written there.
    return this.contentSubmissionService.createSubmission(dto, creatorId, actor, {
      supersedesSubmissionId,
      reviewDeadlineAt,
    });
  }

  // GET /creator-portal/content-submissions?opportunity_id= (US-32a scenario 2, US-33 scenario 2).
  async listForCreator(creatorId: string, opportunityId: string) {
    if (!opportunityId) {
      throw new BadRequestException({
        error: { code: 'OPPORTUNITY_ID_REQUIRED', message: 'opportunity_id e obrigatorio.', details: {} },
      });
    }

    // Scoped to the requesting creator -- cannot list someone else's lineage.
    const opportunity = await this.opportunityRepo.findOne({ where: { id: opportunityId, creatorId } });
    if (!opportunity) {
      throw new NotFoundException({
        error: { code: 'OPPORTUNITY_NOT_FOUND', message: 'Oportunidade nao encontrada.', details: {} },
      });
    }

    const submissions = await this.submissionRepo.find({
      where: { opportunityId },
      order: { versionNumber: 'ASC' },
    });

    const data = await Promise.all(submissions.map((s) => this.formatVersion(s)));
    return { data };
  }

  // GET /campaigns/:id/content-submissions (US-19 review queue, brand side).
  async listForBrand(
    campaignId: string,
    accountId: string,
    query: { opportunityId?: string; reviewStatus?: string; cursor?: string; limit?: number },
  ) {
    await this.findCampaignOrFail(campaignId, accountId);

    const limit = Math.min(query.limit || 20, 100);
    const qb = this.submissionRepo
      .createQueryBuilder('cs')
      .where('cs.campaignId = :campaignId', { campaignId })
      .orderBy('cs.submittedAt', 'DESC')
      .limit(limit + 1);

    if (query.opportunityId) {
      qb.andWhere('cs.opportunityId = :opportunityId', { opportunityId: query.opportunityId });
    }

    if (query.reviewStatus) {
      if (query.reviewStatus === 'pending') {
        qb.andWhere(
          'NOT EXISTS (SELECT 1 FROM content_review_decision crd WHERE crd.content_submission_id = cs.id)',
        );
      } else {
        qb.andWhere(
          'EXISTS (SELECT 1 FROM content_review_decision crd WHERE crd.content_submission_id = cs.id AND crd.decision = :reviewStatus)',
          { reviewStatus: query.reviewStatus },
        );
      }
    }

    if (query.cursor) {
      qb.andWhere(
        'cs.submittedAt < (SELECT submitted_at FROM content_submission WHERE id = :cursor)',
        { cursor: query.cursor },
      );
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);

    const data = await Promise.all(page.map((s) => this.formatBrandVersion(s)));

    return {
      data,
      pagination: {
        next_cursor: hasMore ? page[page.length - 1].id : null,
        has_more: hasMore,
      },
    };
  }

  async findCampaignOrFail(id: string, accountId: string): Promise<Campaign> {
    const campaign = await this.campaignRepo.findOne({ where: { id, accountId } });
    if (!campaign) {
      throw new NotFoundException({
        error: { code: 'CAMPAIGN_NOT_FOUND', message: 'Campanha nao encontrada.', details: {} },
      });
    }
    return campaign;
  }

  private async formatVersion(submission: ContentSubmission) {
    const decision = await this.decisionRepo.findOne({ where: { contentSubmissionId: submission.id } });
    const gate = await this.gateService.getGateStatus(submission.id);

    return {
      id: submission.id,
      version_number: submission.versionNumber,
      supersedes_submission_id: submission.supersedesSubmissionId,
      review_status: decision ? decision.decision : 'pending',
      review_reason: decision ? decision.decisionReason : null,
      review_decided_at: decision ? decision.decidedAt.toISOString() : null,
      review_deadline_at: submission.reviewDeadlineAt ? submission.reviewDeadlineAt.toISOString() : null,
      review_escalated: submission.reviewEscalated,
      safety_gate: { cleared: gate.cleared, blocking_reason: gate.blockingReason },
      published_url: submission.publishedUrl,
      submitted_at: submission.submittedAt.toISOString(),
    };
  }

  private async formatBrandVersion(submission: ContentSubmission) {
    const base = await this.formatVersion(submission);
    const creator = submission.creatorId
      ? await this.creatorRepo.findOne({ where: { id: submission.creatorId } })
      : null;

    const latestInLineage = await this.submissionRepo.findOne({
      where: { rootSubmissionId: submission.rootSubmissionId || submission.id },
      order: { versionNumber: 'DESC' },
    });

    return {
      ...base,
      creator_display_name: creator?.displayName || null,
      latest_version: !latestInLineage || latestInLineage.id === submission.id,
    };
  }
}
