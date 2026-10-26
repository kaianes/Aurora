import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { EntityManager, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { ConfigService } from '@nestjs/config';
import {
  PayoutObligation,
  PayoutObligationStatus,
  PayoutExecutionAttempt,
  PayoutExecutionTrigger,
  PayoutExecutionOutcome,
  CampaignOpportunity,
  OpportunityStatus,
  Campaign,
  Account,
  Creator,
  LedgerReferenceType,
} from '../database/entities';
import { AuditService } from '../audit/audit.service';
import { LedgerService } from './ledger.service';
import { PAYOUT_WINDOW_DAYS, addDays } from './payments.config';
import { isUniqueViolation } from './pg-errors';

export interface ActorContext {
  ipAddress: string;
  userAgent: string;
}

// ADR-0036: the one input shape PaymentsModule's exported service accepts
// from content-workflow's PublicationService.
export interface CreateForConfirmedPublicationInput {
  contentSubmissionId: string;
  campaignId: string;
  creatorId: string;
  opportunityId: string;
  publishedAt: Date | null;
}

export interface CreateForConfirmedPublicationResult {
  payoutObligationId: string;
  alreadyExisted: boolean;
}

interface ListFilters {
  status?: PayoutObligationStatus;
  campaignId?: string;
  cursor?: string;
  limit?: number;
}

interface OperatorListFilters extends ListFilters {
  escalatedForManualReview?: boolean;
}

// The FR-44/FR-45/FR-46/FR-47 service. The only method other modules may
// call is createForConfirmedPublication (ADR-0036); every other method on
// this class serves this module's own controllers and jobs.
@Injectable()
export class PayoutObligationService {
  constructor(
    @InjectRepository(PayoutObligation)
    private obligationRepo: Repository<PayoutObligation>,
    @InjectRepository(PayoutExecutionAttempt)
    private attemptRepo: Repository<PayoutExecutionAttempt>,
    @InjectRepository(CampaignOpportunity)
    private opportunityRepo: Repository<CampaignOpportunity>,
    @InjectRepository(Campaign)
    private campaignRepo: Repository<Campaign>,
    @InjectRepository(Account)
    private accountRepo: Repository<Account>,
    @InjectRepository(Creator)
    private creatorRepo: Repository<Creator>,
    private ledgerService: LedgerService,
    private auditService: AuditService,
    private configService: ConfigService,
    @InjectQueue('payments')
    private paymentsQueue: Queue,
  ) {}

  // ---- US-35a: creation, called from E5's publication-confirmation flow ----

  // `manager` is optional and, when provided, is the caller's own
  // transactional EntityManager -- PublicationService.confirmPublication
  // passes its publication-confirmation transaction here, so that write
  // participates in the same ACID boundary as the published_url/
  // published_at write, rather than opening (and auto-committing) a
  // second, independent one. This is the financial-integrity fix this
  // epic's review required (NFR-13). The read-then-insert below, and the
  // UNIQUE(content_submission_id) race-catch fallback, both keep working
  // identically either way, since they always read and write through
  // whichever repository (manager-bound or this service's own) is
  // resolved below. When no manager is given, this falls back to this
  // service's own injected repositories, unchanged, so this method still
  // works standalone for any future caller that has no transaction of its
  // own to extend.
  async createForConfirmedPublication(
    input: CreateForConfirmedPublicationInput,
    manager?: EntityManager,
  ): Promise<CreateForConfirmedPublicationResult> {
    const obligationRepo = manager ? manager.getRepository(PayoutObligation) : this.obligationRepo;
    const opportunityRepo = manager ? manager.getRepository(CampaignOpportunity) : this.opportunityRepo;

    // Defensive re-checks only (section 2.1 of the E6 architecture doc):
    // the caller's own gates (content_review_decision.decision = approved,
    // the brand-safety gate) have already run by the time this is ever
    // called. This never re-verifies either of those independently.
    if (!input.publishedAt) {
      await this.auditService.log({
        actorUserId: null,
        targetAccountId: null,
        action: 'payout_obligation.creation_refused',
        metadata: {
          content_submission_id: input.contentSubmissionId,
          reason: 'published_at_missing',
        },
      });
      throw new UnprocessableEntityException({
        error: {
          code: 'PAYOUT_OBLIGATION_CREATION_REFUSED',
          message: 'Publicacao nao confirmada: published_at ausente.',
          details: { reason: 'published_at_missing' },
        },
      });
    }

    const existingBefore = await obligationRepo.findOne({
      where: { contentSubmissionId: input.contentSubmissionId },
    });
    if (existingBefore) {
      // US-35a scenario 2: a redelivered/retried call is a no-op.
      return { payoutObligationId: existingBefore.id, alreadyExisted: true };
    }

    const opportunity = await opportunityRepo.findOne({
      where: { id: input.opportunityId },
    });
    if (!opportunity || opportunity.status !== OpportunityStatus.ACCEPTED) {
      await this.auditService.log({
        actorUserId: null,
        targetAccountId: null,
        action: 'payout_obligation.creation_refused',
        metadata: {
          content_submission_id: input.contentSubmissionId,
          opportunity_id: input.opportunityId,
          reason: 'opportunity_not_accepted',
        },
      });
      throw new UnprocessableEntityException({
        error: {
          code: 'PAYOUT_OBLIGATION_CREATION_REFUSED',
          message: 'Oportunidade associada nao esta no estado aceito.',
          details: { reason: 'opportunity_not_accepted' },
        },
      });
    }

    const committedDeadlineAt = addDays(input.publishedAt, PAYOUT_WINDOW_DAYS);

    const obligation = obligationRepo.create({
      contentSubmissionId: input.contentSubmissionId,
      campaignId: input.campaignId,
      creatorId: input.creatorId,
      opportunityId: input.opportunityId,
      payoutGross: opportunity.payoutGross,
      payoutCommission: opportunity.payoutCommission,
      payoutNet: opportunity.payoutNet,
      committedDeadlineAt,
      status: PayoutObligationStatus.OWED,
    });

    try {
      const saved = await obligationRepo.save(obligation);

      await this.auditService.log({
        actorUserId: null,
        targetAccountId: null,
        action: 'payout_obligation.created',
        metadata: {
          payout_obligation_id: saved.id,
          content_submission_id: input.contentSubmissionId,
          campaign_id: input.campaignId,
          creator_id: input.creatorId,
        },
      });

      await this.paymentsQueue.add('attempt-payout-execution', {
        payoutObligationId: saved.id,
      });

      return { payoutObligationId: saved.id, alreadyExisted: false };
    } catch (error) {
      // US-35a scenario 2, the race window: a concurrent call already won
      // the UNIQUE (content_submission_id) insert.
      if (isUniqueViolation(error)) {
        const existing = await obligationRepo.findOne({
          where: { contentSubmissionId: input.contentSubmissionId },
        });
        if (existing) {
          return { payoutObligationId: existing.id, alreadyExisted: true };
        }
      }
      throw error;
    }
  }

  // ---- US-36a: creator-facing history ----

  async listForCreator(creatorId: string, filters: ListFilters) {
    const limit = Math.min(filters.limit || 20, 100);
    const qb = this.obligationRepo
      .createQueryBuilder('o')
      .where('o.creatorId = :creatorId', { creatorId })
      .orderBy('o.createdAt', 'DESC')
      .limit(limit + 1);

    if (filters.status) {
      qb.andWhere('o.status = :status', { status: filters.status });
    }
    if (filters.campaignId) {
      qb.andWhere('o.campaignId = :campaignId', { campaignId: filters.campaignId });
    }
    if (filters.cursor) {
      qb.andWhere(
        'o.createdAt < (SELECT created_at FROM payout_obligation WHERE id = :cursor)',
        { cursor: filters.cursor },
      );
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const data = await Promise.all(page.map((o) => this.formatListItem(o)));

    return {
      data,
      pagination: {
        next_cursor: hasMore ? page[page.length - 1].id : null,
        has_more: hasMore,
      },
    };
  }

  async getForCreator(id: string, creatorId: string) {
    const obligation = await this.findOwnOrFail(id, creatorId);
    const attempts = await this.attemptRepo.find({
      where: { payoutObligationId: id },
      order: { createdAt: 'ASC' },
    });

    return {
      ...(await this.formatListItem(obligation)),
      payout_execution_attempts: attempts.map((a) => this.formatAttempt(a)),
    };
  }

  async getStatement(id: string, creatorId: string) {
    await this.findOwnOrFail(id, creatorId);

    // ADR-0042: generated on request (or a still-valid cached one would be
    // returned here if this pilot persisted a cache entry -- it does not,
    // since the obligation's own fields never go stale between requests).
    // No real PDF-rendering pipeline exists yet, consistent with
    // brand-profile's own logo-upload stub (E1): a deterministic
    // object-storage reference, not a byte stream.
    const s3Key = `statements/${id}/statement.pdf`;
    const baseUrl = this.configService.get('S3_PUBLIC_URL') || 'https://assets.aurora.com.br';
    const generatedAt = new Date();
    const expires = Math.floor(generatedAt.getTime() / 1000) + 3600; // 1 hour

    return {
      payout_obligation_id: id,
      document_url: `${baseUrl}/${s3Key}?expires=${expires}`,
      generated_at: generatedAt.toISOString(),
    };
  }

  // ---- US-20 / US-42 operator reconciliation ----

  async listForOperator(filters: OperatorListFilters) {
    const limit = Math.min(filters.limit || 20, 100);
    const qb = this.obligationRepo
      .createQueryBuilder('o')
      .orderBy('o.createdAt', 'DESC')
      .limit(limit + 1);

    if (filters.status) {
      qb.andWhere('o.status = :status', { status: filters.status });
    }
    if (filters.escalatedForManualReview !== undefined) {
      qb.andWhere('o.escalatedForManualReview = :escalated', {
        escalated: filters.escalatedForManualReview,
      });
    }
    if (filters.cursor) {
      qb.andWhere(
        'o.createdAt < (SELECT created_at FROM payout_obligation WHERE id = :cursor)',
        { cursor: filters.cursor },
      );
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const data = await Promise.all(
      page.map(async (o) => {
        const creator = await this.creatorRepo.findOne({ where: { id: o.creatorId } });
        return {
          ...(await this.formatListItem(o)),
          creator_display_name: creator?.displayName || null,
        };
      }),
    );

    return {
      data,
      pagination: {
        next_cursor: hasMore ? page[page.length - 1].id : null,
        has_more: hasMore,
      },
    };
  }

  async markSettledManually(
    id: string,
    operatorUserId: string,
    providerReference: string | null,
    actor: ActorContext,
  ) {
    const obligation = await this.obligationRepo.findOne({ where: { id } });
    if (!obligation) {
      throw new NotFoundException({
        error: {
          code: 'PAYOUT_OBLIGATION_NOT_FOUND',
          message: 'Obrigacao de pagamento nao encontrada.',
          details: {},
        },
      });
    }
    if (obligation.status === PayoutObligationStatus.SETTLED) {
      throw new ConflictException({
        error: { code: 'ALREADY_SETTLED', message: 'Esta obrigacao ja foi liquidada.', details: {} },
      });
    }

    await this.attemptRepo.save(
      this.attemptRepo.create({
        payoutObligationId: obligation.id,
        idempotencyKey: obligation.id,
        trigger: PayoutExecutionTrigger.MANUAL,
        triggeredByUserId: operatorUserId,
        outcome: PayoutExecutionOutcome.INSTRUCTED,
        providerReference: providerReference || null,
      }),
    );

    await this.applySettlement(obligation);

    await this.auditService.log({
      actorUserId: operatorUserId,
      targetAccountId: null,
      action: 'payout_obligation.manually_settled',
      metadata: { payout_obligation_id: obligation.id, provider_reference: providerReference },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return this.formatListItem(obligation);
  }

  async markFailedManually(
    id: string,
    operatorUserId: string,
    reason: string,
    actor: ActorContext,
  ) {
    const obligation = await this.obligationRepo.findOne({ where: { id } });
    if (!obligation) {
      throw new NotFoundException({
        error: {
          code: 'PAYOUT_OBLIGATION_NOT_FOUND',
          message: 'Obrigacao de pagamento nao encontrada.',
          details: {},
        },
      });
    }
    // Defensive, not explicitly named by section 4.5 the way mark-settled's
    // own guard is -- but settled is this state machine's only terminal
    // state (section 3.4), so marking a settled obligation as failed must
    // never be allowed to revert it back to owed (NFR-13).
    if (obligation.status === PayoutObligationStatus.SETTLED) {
      throw new ConflictException({
        error: { code: 'ALREADY_SETTLED', message: 'Esta obrigacao ja foi liquidada.', details: {} },
      });
    }

    await this.applyFailure(obligation, reason, PayoutExecutionTrigger.MANUAL, operatorUserId);

    await this.auditService.log({
      actorUserId: operatorUserId,
      targetAccountId: null,
      action: 'payout_obligation.manually_failed',
      metadata: { payout_obligation_id: obligation.id, reason },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return this.formatListItem(obligation);
  }

  // ---- Called by this module's own jobs (section 5) ----

  async recordInstructed(obligationId: string, providerReference: string | null) {
    const obligation = await this.obligationRepo.findOne({ where: { id: obligationId } });
    if (!obligation) return;

    await this.attemptRepo.save(
      this.attemptRepo.create({
        payoutObligationId: obligation.id,
        idempotencyKey: obligation.id,
        trigger: PayoutExecutionTrigger.SCHEDULED,
        triggeredByUserId: null,
        outcome: PayoutExecutionOutcome.INSTRUCTED,
        providerReference,
      }),
    );

    obligation.status = PayoutObligationStatus.IN_FLIGHT;
    obligation.inFlightSince = new Date();
    await this.obligationRepo.save(obligation);

    await this.auditService.log({
      actorUserId: null,
      targetAccountId: null,
      action: 'payout_obligation.execution_instructed',
      metadata: { payout_obligation_id: obligation.id },
    });
  }

  async recordScheduledFailure(obligationId: string, reason: string) {
    const obligation = await this.obligationRepo.findOne({ where: { id: obligationId } });
    if (!obligation) return;

    await this.applyFailure(obligation, reason, PayoutExecutionTrigger.SCHEDULED, null);

    await this.auditService.log({
      actorUserId: null,
      targetAccountId: null,
      action: 'payout_obligation.execution_failed',
      metadata: { payout_obligation_id: obligation.id, reason },
    });
  }

  async settleFromPoll(obligationId: string) {
    const obligation = await this.obligationRepo.findOne({ where: { id: obligationId } });
    if (!obligation) return;

    await this.applySettlement(obligation);

    await this.auditService.log({
      actorUserId: null,
      targetAccountId: null,
      action: 'payout_obligation.settled',
      metadata: { payout_obligation_id: obligation.id },
    });
  }

  // ---- Internal helpers ----

  private async findOwnOrFail(id: string, creatorId: string): Promise<PayoutObligation> {
    // Every creator-portal endpoint checks creator_id from the JWT against
    // the resource's creator_id column directly (E3's precedent) -- one
    // error code for "not found" and "not yours" (section 4.3).
    const obligation = await this.obligationRepo.findOne({ where: { id, creatorId } });
    if (!obligation) {
      throw new NotFoundException({
        error: {
          code: 'PAYOUT_OBLIGATION_NOT_FOUND',
          message: 'Obrigacao de pagamento nao encontrada.',
          details: {},
        },
      });
    }
    return obligation;
  }

  private async applyFailure(
    obligation: PayoutObligation,
    reason: string,
    trigger: PayoutExecutionTrigger,
    triggeredByUserId: string | null,
  ) {
    if (trigger === PayoutExecutionTrigger.MANUAL) {
      await this.attemptRepo.save(
        this.attemptRepo.create({
          payoutObligationId: obligation.id,
          idempotencyKey: obligation.id,
          trigger,
          triggeredByUserId,
          outcome: PayoutExecutionOutcome.FAILED,
          failureReason: reason,
        }),
      );
    }

    const now = new Date();
    obligation.lastFailureReason = reason;
    if (!obligation.firstFailureDetectedAt) {
      obligation.firstFailureDetectedAt = now;
    }
    obligation.lastFailureDetectedAt = now;
    // US-35c: failure is never a terminal state -- it always leaves (or
    // returns) the obligation to owed, never a fourth "failed" status.
    obligation.status = PayoutObligationStatus.OWED;
    obligation.inFlightSince = null;
    await this.obligationRepo.save(obligation);

    await this.paymentsQueue.add('notify-payout-failure', {
      payoutObligationId: obligation.id,
      reason,
    });
  }

  private async applySettlement(obligation: PayoutObligation) {
    await this.ledgerService.recordBalancedEntry({
      transactionId: uuidv4(),
      campaignId: obligation.campaignId,
      referenceType: LedgerReferenceType.PAYOUT_OBLIGATION,
      referenceId: obligation.id,
      amount: obligation.payoutNet,
      debitDescription: `Passivo de pagamento liquidado (obrigacao ${obligation.id})`,
      creditDescription: `Fundos repassados ao criador ${obligation.creatorId} (obrigacao ${obligation.id})`,
    });

    obligation.status = PayoutObligationStatus.SETTLED;
    obligation.settledAt = new Date();
    obligation.inFlightSince = null;
    await this.obligationRepo.save(obligation);

    await this.paymentsQueue.add('generate-tax-document', { payoutObligationId: obligation.id });
  }

  private async formatListItem(obligation: PayoutObligation) {
    const campaign = await this.campaignRepo.findOne({ where: { id: obligation.campaignId } });
    const account = campaign
      ? await this.accountRepo.findOne({ where: { id: campaign.accountId } })
      : null;

    return {
      id: obligation.id,
      campaign_id: obligation.campaignId,
      campaign_name: campaign?.name || null,
      buyer_name: account?.name || null,
      payout_gross: obligation.payoutGross,
      payout_commission: obligation.payoutCommission,
      payout_net: obligation.payoutNet,
      status: obligation.status,
      committed_deadline_at: obligation.committedDeadlineAt.toISOString(),
      last_failure_reason: obligation.lastFailureReason,
      escalated_for_manual_review: obligation.escalatedForManualReview,
      settled_at: obligation.settledAt?.toISOString() || null,
      created_at: obligation.createdAt.toISOString(),
    } as Record<string, any>;
  }

  private formatAttempt(attempt: PayoutExecutionAttempt) {
    return {
      id: attempt.id,
      trigger: attempt.trigger,
      outcome: attempt.outcome,
      failure_reason: attempt.failureReason,
      provider_reference: attempt.providerReference,
      created_at: attempt.createdAt.toISOString(),
    };
  }
}
