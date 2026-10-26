import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Campaign, ContentSubmission, ContentReviewDecision, ContentReviewDecisionValue } from '../database/entities';
import { AuditService } from '../audit/audit.service';
import { DecideSubmissionDto } from './dto/decide-submission.dto';

interface ActorContext {
  userId: string;
  ipAddress: string;
  userAgent: string;
}

const DECISION_MAP: Record<string, ContentReviewDecisionValue> = {
  approved: ContentReviewDecisionValue.APPROVED,
  rejected: ContentReviewDecisionValue.REJECTED,
  revision_requested: ContentReviewDecisionValue.REVISION_REQUESTED,
};

// US-19 (Marina approves/rejects/requests revision, with a stated reason).
// A deliberately separate record from E4's safety_review_queue_item
// (ADR-0026) -- this endpoint never consults BrandSafetyGateService; Marina's
// creative decision and the brand-safety gate are independent (ADR-0027).
@Injectable()
export class ReviewDecisionService {
  constructor(
    @InjectRepository(ContentSubmission)
    private submissionRepo: Repository<ContentSubmission>,
    @InjectRepository(ContentReviewDecision)
    private decisionRepo: Repository<ContentReviewDecision>,
    @InjectRepository(Campaign)
    private campaignRepo: Repository<Campaign>,
    private auditService: AuditService,
  ) {}

  async decide(submissionId: string, accountId: string, dto: DecideSubmissionDto, actor: ActorContext) {
    const submission = await this.findSubmissionOrFail(submissionId, accountId);

    if (dto.decision !== 'approved' && (!dto.reason || dto.reason.trim().length === 0)) {
      throw new UnprocessableEntityException({
        error: {
          code: 'REASON_REQUIRED',
          message: 'E necessario informar um motivo para esta decisao.',
          details: {},
        },
      });
    }

    const existing = await this.decisionRepo.findOne({ where: { contentSubmissionId: submissionId } });
    if (existing) {
      throw new ConflictException({
        error: {
          code: 'ALREADY_DECIDED',
          message: 'Esta versao ja foi decidida anteriormente.',
          details: {},
        },
      });
    }

    const decided = await this.decisionRepo.save(
      this.decisionRepo.create({
        contentSubmissionId: submissionId,
        campaignId: submission.campaignId,
        decision: DECISION_MAP[dto.decision],
        decisionReason: dto.reason || null,
        decidedByUserId: actor.userId,
        decidedAt: new Date(),
      }),
    );

    await this.auditService.log({
      actorUserId: actor.userId,
      targetAccountId: accountId,
      action: 'content_submission.reviewed',
      metadata: { content_submission_id: submissionId, decision: decided.decision },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return {
      id: decided.id,
      content_submission_id: submissionId,
      decision: decided.decision,
      decided_at: decided.decidedAt.toISOString(),
    };
  }

  private async findSubmissionOrFail(id: string, accountId: string): Promise<ContentSubmission> {
    const submission = await this.submissionRepo.findOne({ where: { id } });
    if (!submission) {
      throw new NotFoundException({
        error: { code: 'SUBMISSION_NOT_FOUND', message: 'Submissao nao encontrada.', details: {} },
      });
    }
    const campaign = await this.campaignRepo.findOne({ where: { id: submission.campaignId, accountId } });
    if (!campaign) {
      throw new NotFoundException({
        error: { code: 'SUBMISSION_NOT_FOUND', message: 'Submissao nao encontrada.', details: {} },
      });
    }
    return submission;
  }
}
