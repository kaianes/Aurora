import {
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  Campaign,
  Creator,
  ContentSubmission,
  SafetyCheck,
  SafetyReviewQueueItem,
  ReviewItemStatus,
  SafetyRuleTrigger,
  SafetyRule,
} from '../database/entities';
import { AuditService } from '../audit/audit.service';
import { DecideReviewDto } from './dto/decide-review.dto';

interface ActorContext {
  userId: string;
  ipAddress: string;
  userAgent: string;
}

// US-17 scenario 3 / ADR-0023: the queue's GET endpoints return a
// structured 503 rather than letting an unexpected error surface as a blank
// or misleadingly empty list. The underlying gate computation (section 2.8,
// BrandSafetyGateService) is a separate read path and stays unaffected by
// this failure.
const QUEUE_UNAVAILABLE_ERROR = {
  error: {
    code: 'REVIEW_QUEUE_UNAVAILABLE',
    message: 'A fila de revisao esta temporariamente indisponivel. Tente novamente em alguns instantes.',
    details: {},
  },
};

@Injectable()
export class ReviewQueueService {
  constructor(
    @InjectRepository(SafetyReviewQueueItem)
    private reviewRepo: Repository<SafetyReviewQueueItem>,
    @InjectRepository(ContentSubmission)
    private submissionRepo: Repository<ContentSubmission>,
    @InjectRepository(SafetyCheck)
    private checkRepo: Repository<SafetyCheck>,
    @InjectRepository(SafetyRuleTrigger)
    private triggerRepo: Repository<SafetyRuleTrigger>,
    @InjectRepository(SafetyRule)
    private ruleRepo: Repository<SafetyRule>,
    @InjectRepository(Campaign)
    private campaignRepo: Repository<Campaign>,
    @InjectRepository(Creator)
    private creatorRepo: Repository<Creator>,
    private auditService: AuditService,
  ) {}

  async list(accountId: string, status: string = 'pending', cursor?: string, limit = 20) {
    try {
      const qb = this.reviewRepo
        .createQueryBuilder('ri')
        .innerJoin(Campaign, 'c', 'c.id = ri.campaignId')
        .where('c.accountId = :accountId', { accountId })
        .andWhere('ri.status = :status', { status })
        .orderBy('ri.createdAt', 'DESC')
        .limit(Math.min(limit, 100) + 1);

      if (cursor) {
        qb.andWhere(
          'ri.createdAt < (SELECT created_at FROM safety_review_queue_item WHERE id = :cursor)',
          { cursor },
        );
      }

      const rows = await qb.getMany();
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const data = await Promise.all(page.map((item) => this.formatListItem(item)));

      return {
        data,
        pagination: {
          next_cursor: hasMore ? page[page.length - 1].id : null,
          has_more: hasMore,
        },
      };
    } catch (error) {
      return this.wrapUnavailable(error);
    }
  }

  async getDetail(id: string, accountId: string) {
    try {
      const item = await this.findItemOrFail(id, accountId);
      const submission = await this.submissionRepo.findOne({ where: { id: item.contentSubmissionId } });
      const check = await this.checkRepo.findOne({ where: { id: item.safetyCheckId } });
      const campaign = await this.campaignRepo.findOne({ where: { id: item.campaignId } });
      const creator = submission?.creatorId
        ? await this.creatorRepo.findOne({ where: { id: submission.creatorId } })
        : null;

      const triggers = await this.triggerRepo.find({ where: { safetyCheckId: item.safetyCheckId } });
      const ruleIds = [...new Set(triggers.filter((t) => t.ruleId).map((t) => t.ruleId as string))];
      const rules = ruleIds.length > 0 ? await this.ruleRepo.find({ where: { id: In(ruleIds) } }) : [];
      const ruleById = new Map(rules.map((r) => [r.id, r]));

      return {
        id: item.id,
        content_submission_id: item.contentSubmissionId,
        campaign_id: item.campaignId,
        campaign_name: campaign?.name || null,
        creator_display_name: creator?.displayName || null,
        reason_category: item.reasonCategory,
        status: item.status,
        decision_reason: item.decisionReason,
        decided_by_user_id: item.decidedByUserId,
        decided_at: item.decidedAt?.toISOString() || null,
        created_at: item.createdAt.toISOString(),
        tier_reached: check?.tierReached || null,
        submission: submission
          ? {
              caption_text: submission.captionText,
              on_screen_text: submission.onScreenText,
              audio_transcript: submission.audioTranscript,
            }
          : null,
        // Every triggered rule with its full rule definition, not just the
        // excerpt (section 3.4 of the E4 architecture doc).
        triggered_rules: triggers.map((t) => {
          const rule = t.ruleId ? ruleById.get(t.ruleId) : undefined;
          return {
            rule_id: t.ruleId,
            channel: t.channel,
            matched_excerpt: t.matchedExcerpt,
            rule: rule
              ? {
                  id: rule.id,
                  rule_type: rule.ruleType,
                  definition: rule.definition,
                  action: rule.action,
                  supersedes_rule_id: rule.supersedesRuleId,
                }
              : null,
          };
        }),
      };
    } catch (error) {
      return this.wrapUnavailable(error);
    }
  }

  async decide(id: string, accountId: string, dto: DecideReviewDto, actor: ActorContext) {
    try {
      const item = await this.findItemOrFail(id, accountId);

      if (dto.decision !== 'approved' && (!dto.reason || dto.reason.trim().length === 0)) {
        throw new UnprocessableEntityException({
          error: {
            code: 'REASON_REQUIRED',
            message: 'E necessario informar um motivo para esta decisao.',
            details: {},
          },
        });
      }

      if (item.status !== ReviewItemStatus.PENDING) {
        throw new ConflictException({
          error: {
            code: 'ALREADY_DECIDED',
            message: 'Este item ja foi decidido anteriormente.',
            details: {},
          },
        });
      }

      // ADR-0023: safety_check is never touched here. The human decision
      // lives entirely in safety_review_queue_item and is read by the gate
      // computation as an override, never a correction of the automated
      // verdict.
      item.status = this.mapDecision(dto.decision);
      item.decidedByUserId = actor.userId;
      item.decidedAt = new Date();
      item.decisionReason = dto.reason || null;
      const saved = await this.reviewRepo.save(item);

      const triggers = await this.triggerRepo.find({ where: { safetyCheckId: item.safetyCheckId } });

      await this.auditService.log({
        actorUserId: actor.userId,
        targetAccountId: accountId,
        action: 'safety_review.decided',
        metadata: {
          review_item_id: saved.id,
          decision: saved.status,
          triggered_rules: triggers.map((t) => ({
            rule_id: t.ruleId,
            channel: t.channel,
            matched_excerpt: t.matchedExcerpt,
          })),
        },
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });

      return {
        id: saved.id,
        status: saved.status,
        decided_at: saved.decidedAt!.toISOString(),
      };
    } catch (error) {
      return this.wrapUnavailable(error);
    }
  }

  private mapDecision(decision: 'approved' | 'rejected' | 'revision_requested'): ReviewItemStatus {
    if (decision === 'approved') return ReviewItemStatus.APPROVED;
    if (decision === 'rejected') return ReviewItemStatus.REJECTED;
    return ReviewItemStatus.REVISION_REQUESTED;
  }

  private async formatListItem(item: SafetyReviewQueueItem) {
    const submission = await this.submissionRepo.findOne({ where: { id: item.contentSubmissionId } });
    const campaign = await this.campaignRepo.findOne({ where: { id: item.campaignId } });
    const creator = submission?.creatorId
      ? await this.creatorRepo.findOne({ where: { id: submission.creatorId } })
      : null;

    const triggers = await this.triggerRepo.find({ where: { safetyCheckId: item.safetyCheckId } });
    const ruleIds = [...new Set(triggers.filter((t) => t.ruleId).map((t) => t.ruleId as string))];
    const rules = ruleIds.length > 0 ? await this.ruleRepo.find({ where: { id: In(ruleIds) } }) : [];
    const ruleById = new Map(rules.map((r) => [r.id, r]));

    return {
      id: item.id,
      content_submission_id: item.contentSubmissionId,
      campaign_id: item.campaignId,
      campaign_name: campaign?.name || null,
      creator_display_name: creator?.displayName || null,
      reason_category: item.reasonCategory,
      // US-17 scenario 2: every rule triggered, not just the first one found.
      triggered_rules: triggers.map((t) => ({
        rule_id: t.ruleId,
        rule_type: t.ruleId ? ruleById.get(t.ruleId)?.ruleType || null : null,
        channel: t.channel,
        matched_excerpt: t.matchedExcerpt,
      })),
      status: item.status,
      created_at: item.createdAt.toISOString(),
    };
  }

  private async findItemOrFail(id: string, accountId: string): Promise<SafetyReviewQueueItem> {
    const item = await this.reviewRepo
      .createQueryBuilder('ri')
      .innerJoin(Campaign, 'c', 'c.id = ri.campaignId')
      .where('ri.id = :id', { id })
      .andWhere('c.accountId = :accountId', { accountId })
      .getOne();
    if (!item) {
      throw new NotFoundException({
        error: { code: 'REVIEW_ITEM_NOT_FOUND', message: 'Item de revisao nao encontrado.', details: {} },
      });
    }
    return item;
  }

  private wrapUnavailable(error: unknown): never {
    if (error instanceof HttpException) {
      throw error;
    }
    throw new ServiceUnavailableException(QUEUE_UNAVAILABLE_ERROR);
  }
}
