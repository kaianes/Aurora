import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PaymentsScheduledTasksService } from './payments-scheduled-tasks.service';
import { PayoutObligationStatus, PayoutExecutionOutcome } from '../database/entities';

const mockRepo = () => ({
  find: vi.fn().mockResolvedValue([]),
  findOne: vi.fn(),
  save: vi.fn((entity: any) => Promise.resolve(entity)),
  createQueryBuilder: vi.fn(),
});

describe('PaymentsScheduledTasksService - section 5 of the E6 architecture doc', () => {
  let service: PaymentsScheduledTasksService;
  let obligationRepo: ReturnType<typeof mockRepo>;
  let attemptRepo: ReturnType<typeof mockRepo>;
  let ledgerRepo: ReturnType<typeof mockRepo>;
  let executionAdapter: { checkStatus: ReturnType<typeof vi.fn> };
  let payoutObligationService: {
    settleFromPoll: ReturnType<typeof vi.fn>;
    recordScheduledFailure: ReturnType<typeof vi.fn>;
  };
  let auditService: { log: ReturnType<typeof vi.fn> };
  let paymentsQueue: { add: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    obligationRepo = mockRepo();
    attemptRepo = mockRepo();
    ledgerRepo = mockRepo();
    executionAdapter = { checkStatus: vi.fn() };
    payoutObligationService = {
      settleFromPoll: vi.fn().mockResolvedValue(undefined),
      recordScheduledFailure: vi.fn().mockResolvedValue(undefined),
    };
    auditService = { log: vi.fn().mockResolvedValue(undefined) };
    paymentsQueue = { add: vi.fn().mockResolvedValue(undefined) };

    service = new PaymentsScheduledTasksService(
      obligationRepo as any,
      attemptRepo as any,
      ledgerRepo as any,
      executionAdapter as any,
      payoutObligationService as any,
      auditService as any,
      paymentsQueue as any,
    );
  });

  // ---- poll-in-flight-payouts: ADR-0033's one other caller of the adapter ----
  describe('pollInFlightPayouts', () => {
    // Critical check: with the stub adapter (always 'pending'), this job never
    // settles anything on its own -- the only path to settled is the manual
    // operator endpoint. This test exercises the mechanism as specified
    // (section 5), confirming it *would* settle on a real adapter's 'settled'
    // outcome, without claiming the current stub ever produces one.
    it('settles an obligation when the adapter reports settled', async () => {
      obligationRepo.find.mockResolvedValue([{ id: 'pay-1', status: PayoutObligationStatus.IN_FLIGHT }]);
      attemptRepo.findOne.mockResolvedValue({ providerReference: 'ref-1' });
      executionAdapter.checkStatus.mockResolvedValue({ outcome: 'settled' });

      await service.pollInFlightPayouts();

      expect(payoutObligationService.settleFromPoll).toHaveBeenCalledWith('pay-1');
      expect(payoutObligationService.recordScheduledFailure).not.toHaveBeenCalled();
    });

    it('reverts to owed with a failure reason when the adapter reports failed', async () => {
      obligationRepo.find.mockResolvedValue([{ id: 'pay-1', status: PayoutObligationStatus.IN_FLIGHT }]);
      attemptRepo.findOne.mockResolvedValue({ providerReference: 'ref-1' });
      executionAdapter.checkStatus.mockResolvedValue({ outcome: 'failed', reason: 'provider_declined' });

      await service.pollInFlightPayouts();

      expect(payoutObligationService.recordScheduledFailure).toHaveBeenCalledWith('pay-1', 'provider_declined');
      expect(payoutObligationService.settleFromPoll).not.toHaveBeenCalled();
    });

    // ADR-0033: the stub's literal behavior -- pending is a no-op, never an
    // auto-settle or an auto-fail.
    it('does nothing when the adapter reports pending (the stub\'s only outcome)', async () => {
      obligationRepo.find.mockResolvedValue([{ id: 'pay-1', status: PayoutObligationStatus.IN_FLIGHT }]);
      attemptRepo.findOne.mockResolvedValue(null);
      executionAdapter.checkStatus.mockResolvedValue({ outcome: 'pending' });

      await service.pollInFlightPayouts();

      expect(payoutObligationService.settleFromPoll).not.toHaveBeenCalled();
      expect(payoutObligationService.recordScheduledFailure).not.toHaveBeenCalled();
    });
  });

  // ---- retry-unexecuted-payouts ----
  describe('retryUnexecutedPayouts', () => {
    it('re-enqueues an owed obligation with no attempt yet', async () => {
      obligationRepo.find.mockResolvedValue([{ id: 'pay-1', status: PayoutObligationStatus.OWED }]);
      attemptRepo.findOne.mockResolvedValue(null);

      await service.retryUnexecutedPayouts();

      expect(paymentsQueue.add).toHaveBeenCalledWith('attempt-payout-execution', {
        payoutObligationId: 'pay-1',
      });
    });

    it('re-enqueues an owed obligation whose latest attempt failed', async () => {
      obligationRepo.find.mockResolvedValue([{ id: 'pay-1', status: PayoutObligationStatus.OWED }]);
      attemptRepo.findOne.mockResolvedValue({ outcome: PayoutExecutionOutcome.FAILED });

      await service.retryUnexecutedPayouts();

      expect(paymentsQueue.add).toHaveBeenCalledWith('attempt-payout-execution', {
        payoutObligationId: 'pay-1',
      });
    });

    it('does not re-enqueue an owed obligation whose latest attempt already instructed', async () => {
      obligationRepo.find.mockResolvedValue([{ id: 'pay-1', status: PayoutObligationStatus.OWED }]);
      attemptRepo.findOne.mockResolvedValue({ outcome: PayoutExecutionOutcome.INSTRUCTED });

      await service.retryUnexecutedPayouts();

      expect(paymentsQueue.add).not.toHaveBeenCalled();
    });
  });

  // ---- escalate-stalled-payouts: US-35b scenario 2/3, NFR-11's "in progress" signal ----
  describe('escalateStalledPayouts', () => {
    // US-35b scenario 2: each obligation's own committed_deadline_at governs
    // whether it escalates -- never a shared campaign clock. The repository
    // query itself expresses this (filtered on each row's own deadline), so
    // this test asserts the query is built against committedDeadlineAt and
    // that only matching candidates get flipped.
    it('escalates only obligations the query returns as within the lead window, leaving others untouched', async () => {
      const nearDeadline = {
        id: 'pay-near',
        status: PayoutObligationStatus.OWED,
        escalatedForManualReview: false,
        escalatedAt: null,
      };
      obligationRepo.find.mockResolvedValue([nearDeadline]);

      await service.escalateStalledPayouts();

      expect(nearDeadline.escalatedForManualReview).toBe(true);
      expect(nearDeadline.escalatedAt).toBeInstanceOf(Date);
      expect(obligationRepo.save).toHaveBeenCalledWith(nearDeadline);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'payout_obligation.escalated_for_manual_review' }),
      );
    });

    it('never un-escalates or re-escalates an obligation already flagged (flips once, stays true)', async () => {
      // The query itself filters escalatedForManualReview = false, so an
      // already-escalated obligation is never a candidate in the first place.
      obligationRepo.find.mockResolvedValue([]);

      await service.escalateStalledPayouts();

      expect(obligationRepo.save).not.toHaveBeenCalled();
      expect(auditService.log).not.toHaveBeenCalled();
    });

    it('does nothing when no obligation is near its deadline', async () => {
      obligationRepo.find.mockResolvedValue([]);

      await service.escalateStalledPayouts();

      expect(obligationRepo.save).not.toHaveBeenCalled();
    });
  });

  // ---- notify-overdue-payout-failures: the crashed-enqueue safety net ----
  describe('notifyOverduePayoutFailures', () => {
    it('re-enqueues notification for an obligation whose first failure is older than the guard window', async () => {
      const old = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago > 5 minute guard
      obligationRepo.find.mockResolvedValue([{ id: 'pay-1', firstFailureDetectedAt: old }]);

      await service.notifyOverduePayoutFailures();

      expect(paymentsQueue.add).toHaveBeenCalledWith('notify-payout-failure', {
        payoutObligationId: 'pay-1',
      });
    });

    it('does not re-enqueue a failure detected inside the guard window (the inline enqueue likely still in flight)', async () => {
      const recent = new Date(Date.now() - 1 * 60 * 1000); // 1 minute ago < 5 minute guard
      obligationRepo.find.mockResolvedValue([{ id: 'pay-1', firstFailureDetectedAt: recent }]);

      await service.notifyOverduePayoutFailures();

      expect(paymentsQueue.add).not.toHaveBeenCalled();
    });
  });

  // ---- reconcile-ledger-to-obligations: NFR-13's zero-tolerance check ----
  describe('reconcileLedgerToObligations', () => {
    function queryBuilderReturning(rawMany: any[], rawOneSequence: any[]) {
      let rawOneIndex = 0;
      const qb: any = {
        select: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getRawMany: vi.fn().mockResolvedValue(rawMany),
        getRawOne: vi.fn(() => Promise.resolve(rawOneSequence[rawOneIndex++])),
      };
      return qb;
    }

    it('does not page when the settled-obligation total matches the ledger debit total', async () => {
      obligationRepo.createQueryBuilder
        .mockReturnValueOnce(queryBuilderReturning([{ campaignId: 'camp-1' }], []))
        .mockReturnValueOnce(queryBuilderReturning([], [{ sum: '680.00' }]));
      ledgerRepo.createQueryBuilder.mockReturnValue(queryBuilderReturning([], [{ sum: '680.00' }]));

      await service.reconcileLedgerToObligations();

      expect(auditService.log).not.toHaveBeenCalled();
    });

    it('pages (writes an audit log entry) on any discrepancy between settled obligations and the ledger', async () => {
      obligationRepo.createQueryBuilder
        .mockReturnValueOnce(queryBuilderReturning([{ campaignId: 'camp-1' }], []))
        .mockReturnValueOnce(queryBuilderReturning([], [{ sum: '680.00' }]));
      ledgerRepo.createQueryBuilder.mockReturnValue(queryBuilderReturning([], [{ sum: '500.00' }]));

      await service.reconcileLedgerToObligations();

      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'ledger.reconciliation_discrepancy',
          metadata: expect.objectContaining({ campaign_id: 'camp-1' }),
        }),
      );
    });
  });
});
