import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bull';
import { IsNull, LessThanOrEqual, Not, Repository } from 'typeorm';
import { Queue } from 'bull';
import {
  PayoutObligation,
  PayoutObligationStatus,
  PayoutExecutionAttempt,
  PayoutExecutionOutcome,
  LedgerEntry,
  LedgerDirection,
  LedgerReferenceType,
} from '../database/entities';
import { AuditService } from '../audit/audit.service';
import { PayoutObligationService } from './payout-obligation.service';
import {
  PAYOUT_EXECUTION_ADAPTER,
  PayoutExecutionAdapter,
} from './adapters/payout-execution.adapter';
import {
  PAYOUT_ESCALATION_LEAD_HOURS,
  POLL_IN_FLIGHT_PAYOUTS_CRON,
  RETRY_UNEXECUTED_PAYOUTS_CRON,
  ESCALATE_STALLED_PAYOUTS_CRON,
  NOTIFY_OVERDUE_PAYOUT_FAILURES_CRON,
  NOTIFY_OVERDUE_GUARD_MINUTES,
  RECONCILE_LEDGER_CRON,
} from './payments.config';

const RECONCILIATION_TOLERANCE = 0.01; // BRL cents-level float slack

// Section 5 of the E6 architecture doc: every cron-triggered job this epic
// defines. attempt-payout-execution and notify-payout-failure (the two
// queue-triggered jobs that fire immediately on an event) live in their
// own processor classes.
@Injectable()
export class PaymentsScheduledTasksService {
  private readonly logger = new Logger(PaymentsScheduledTasksService.name);

  constructor(
    @InjectRepository(PayoutObligation)
    private obligationRepo: Repository<PayoutObligation>,
    @InjectRepository(PayoutExecutionAttempt)
    private attemptRepo: Repository<PayoutExecutionAttempt>,
    @InjectRepository(LedgerEntry)
    private ledgerRepo: Repository<LedgerEntry>,
    @Inject(PAYOUT_EXECUTION_ADAPTER)
    private executionAdapter: PayoutExecutionAdapter,
    private payoutObligationService: PayoutObligationService,
    private auditService: AuditService,
    @InjectQueue('payments')
    private paymentsQueue: Queue,
  ) {}

  // ADR-0033: the stub adapter's checkStatus always reports pending, so in
  // this pilot settlement comes only through the operator endpoints
  // (section 4.5) -- this job exists so a future real-adapter swap needs no
  // new job, only a real checkStatus implementation.
  @Cron(POLL_IN_FLIGHT_PAYOUTS_CRON)
  async pollInFlightPayouts() {
    const inFlight = await this.obligationRepo.find({
      where: { status: PayoutObligationStatus.IN_FLIGHT },
    });

    for (const obligation of inFlight) {
      const latestInstructed = await this.attemptRepo.findOne({
        where: { payoutObligationId: obligation.id, outcome: PayoutExecutionOutcome.INSTRUCTED },
        order: { createdAt: 'DESC' },
      });

      const result = await this.executionAdapter.checkStatus({
        providerReference: latestInstructed?.providerReference || null,
        payoutObligationId: obligation.id,
      });

      if (result.outcome === 'settled') {
        await this.payoutObligationService.settleFromPoll(obligation.id);
      } else if (result.outcome === 'failed') {
        await this.payoutObligationService.recordScheduledFailure(obligation.id, result.reason);
      }
      // 'pending': no-op by design.
    }
  }

  @Cron(RETRY_UNEXECUTED_PAYOUTS_CRON)
  async retryUnexecutedPayouts() {
    const owed = await this.obligationRepo.find({ where: { status: PayoutObligationStatus.OWED } });
    let enqueued = 0;

    for (const obligation of owed) {
      const latestAttempt = await this.attemptRepo.findOne({
        where: { payoutObligationId: obligation.id },
        order: { createdAt: 'DESC' },
      });
      if (!latestAttempt || latestAttempt.outcome === PayoutExecutionOutcome.FAILED) {
        await this.paymentsQueue.add('attempt-payout-execution', {
          payoutObligationId: obligation.id,
        });
        enqueued += 1;
      }
    }

    if (enqueued > 0) {
      this.logger.log(`Re-enqueued ${enqueued} unexecuted/failed payouts for retry`);
    }
  }

  // NFR-11's "in progress" signal, a full lead window before a deadline is
  // breached (ADR-0030's exact precedent: flips once, true, never un-set).
  @Cron(ESCALATE_STALLED_PAYOUTS_CRON)
  async escalateStalledPayouts() {
    const leadThreshold = new Date(Date.now() + PAYOUT_ESCALATION_LEAD_HOURS * 60 * 60 * 1000);
    const candidates = await this.obligationRepo.find({
      where: {
        status: Not(PayoutObligationStatus.SETTLED),
        escalatedForManualReview: false,
        committedDeadlineAt: LessThanOrEqual(leadThreshold),
      },
    });

    for (const obligation of candidates) {
      obligation.escalatedForManualReview = true;
      obligation.escalatedAt = new Date();
      await this.obligationRepo.save(obligation);

      await this.auditService.log({
        actorUserId: null,
        targetAccountId: null,
        action: 'payout_obligation.escalated_for_manual_review',
        metadata: { payout_obligation_id: obligation.id },
      });
    }

    if (candidates.length > 0) {
      this.logger.log(`Escalated ${candidates.length} stalled payout obligations`);
    }
  }

  // Crashed-enqueue guard, same precedent as E2's expire-pending-quotes:
  // guarantees the 24-hour SLA holds even if the inline enqueue is lost.
  @Cron(NOTIFY_OVERDUE_PAYOUT_FAILURES_CRON)
  async notifyOverduePayoutFailures() {
    const guardCutoff = new Date(Date.now() - NOTIFY_OVERDUE_GUARD_MINUTES * 60 * 1000);
    const candidates = await this.obligationRepo.find({
      where: { failureNotificationSentAt: IsNull(), firstFailureDetectedAt: Not(IsNull()) },
    });

    let reenqueued = 0;
    for (const obligation of candidates) {
      if (!obligation.firstFailureDetectedAt || obligation.firstFailureDetectedAt > guardCutoff) {
        continue;
      }
      await this.paymentsQueue.add('notify-payout-failure', {
        payoutObligationId: obligation.id,
      });
      reenqueued += 1;
    }

    if (reenqueued > 0) {
      this.logger.log(`Re-enqueued ${reenqueued} overdue payout-failure notifications`);
    }
  }

  // NFR-13's zero-tolerance reconciliation: sums settled obligations
  // against ledger entries per campaign and pages on any discrepancy.
  @Cron(RECONCILE_LEDGER_CRON)
  async reconcileLedgerToObligations() {
    const campaignRows = await this.obligationRepo
      .createQueryBuilder('o')
      .select('DISTINCT o.campaignId', 'campaignId')
      .where('o.status = :status', { status: PayoutObligationStatus.SETTLED })
      .getRawMany();

    for (const row of campaignRows) {
      const campaignId = row.campaignId;

      const settledRow = await this.obligationRepo
        .createQueryBuilder('o')
        .select('COALESCE(SUM(o.payoutNet), 0)', 'sum')
        .where('o.campaignId = :campaignId', { campaignId })
        .andWhere('o.status = :status', { status: PayoutObligationStatus.SETTLED })
        .getRawOne();

      const ledgerRow = await this.ledgerRepo
        .createQueryBuilder('l')
        .select('COALESCE(SUM(l.amount), 0)', 'sum')
        .where('l.campaignId = :campaignId', { campaignId })
        .andWhere('l.direction = :direction', { direction: LedgerDirection.DEBIT })
        .andWhere('l.referenceType = :refType', {
          refType: LedgerReferenceType.PAYOUT_OBLIGATION,
        })
        .getRawOne();

      const settledTotal = parseFloat(settledRow?.sum || '0');
      const ledgerTotal = parseFloat(ledgerRow?.sum || '0');

      if (Math.abs(settledTotal - ledgerTotal) > RECONCILIATION_TOLERANCE) {
        this.logger.error(
          `Ledger reconciliation discrepancy for campaign ${campaignId}: obligations=${settledTotal} ledger=${ledgerTotal}`,
        );
        await this.auditService.log({
          actorUserId: null,
          targetAccountId: null,
          action: 'ledger.reconciliation_discrepancy',
          metadata: { campaign_id: campaignId, settled_total: settledTotal, ledger_total: ledgerTotal },
        });
      }
    }
  }
}
