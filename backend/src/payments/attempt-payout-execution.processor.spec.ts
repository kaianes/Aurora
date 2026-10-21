import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AttemptPayoutExecutionProcessor } from './attempt-payout-execution.processor';
import { PayoutObligationStatus } from '../database/entities';

const mockRepo = () => ({
  findOne: vi.fn(),
});

function job(data: any) {
  return { data } as any;
}

// US-35b (FR-45) and US-35c (FR-46) at the job level: the processor that
// calls into PayoutExecutionAdapter.executeTransfer (ADR-0033). The stub
// adapter always reports 'instructed', never 'settled' on its own -- this
// processor is the one place executeTransfer is ever called from, alongside
// poll-in-flight-payouts' checkStatus call, per ADR-0033's exact scope.
describe('AttemptPayoutExecutionProcessor - US-35b/US-35c', () => {
  let processor: AttemptPayoutExecutionProcessor;
  let obligationRepo: ReturnType<typeof mockRepo>;
  let executionAdapter: { executeTransfer: ReturnType<typeof vi.fn> };
  let payoutObligationService: {
    recordInstructed: ReturnType<typeof vi.fn>;
    recordScheduledFailure: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    obligationRepo = mockRepo();
    executionAdapter = { executeTransfer: vi.fn() };
    payoutObligationService = {
      recordInstructed: vi.fn().mockResolvedValue(undefined),
      recordScheduledFailure: vi.fn().mockResolvedValue(undefined),
    };

    processor = new AttemptPayoutExecutionProcessor(
      obligationRepo as any,
      executionAdapter as any,
      payoutObligationService as any,
    );
  });

  // ---- US-35b scenario 1: a normal instructed attempt ----
  it('records the attempt as instructed when the adapter reports instructed', async () => {
    obligationRepo.findOne.mockResolvedValue({
      id: 'pay-1',
      status: PayoutObligationStatus.OWED,
      creatorId: 'creator-1',
      payoutNet: '680.00',
    });
    executionAdapter.executeTransfer.mockResolvedValue({
      outcome: 'instructed',
      providerReference: null,
    });

    await processor.handle(job({ payoutObligationId: 'pay-1' }));

    expect(executionAdapter.executeTransfer).toHaveBeenCalledWith(
      expect.objectContaining({ payoutObligationId: 'pay-1', idempotencyKey: 'pay-1' }),
    );
    expect(payoutObligationService.recordInstructed).toHaveBeenCalledWith('pay-1', null);
    expect(payoutObligationService.recordScheduledFailure).not.toHaveBeenCalled();
  });

  // ---- US-35c scenario 1: the adapter reports a failure explicitly ----
  it('records a scheduled failure with the adapter-reported reason', async () => {
    obligationRepo.findOne.mockResolvedValue({
      id: 'pay-1',
      status: PayoutObligationStatus.OWED,
      creatorId: 'creator-1',
      payoutNet: '680.00',
    });
    executionAdapter.executeTransfer.mockResolvedValue({
      outcome: 'failed',
      reason: 'provider_unreachable',
    });

    await processor.handle(job({ payoutObligationId: 'pay-1' }));

    expect(payoutObligationService.recordScheduledFailure).toHaveBeenCalledWith(
      'pay-1',
      'provider_unreachable',
    );
    expect(payoutObligationService.recordInstructed).not.toHaveBeenCalled();
  });

  // ---- US-35b scenario 3: the adapter call itself throws (a scheduling/provider issue) ----
  it('records a scheduled failure when the adapter throws, rather than letting the job crash silently', async () => {
    obligationRepo.findOne.mockResolvedValue({
      id: 'pay-1',
      status: PayoutObligationStatus.OWED,
      creatorId: 'creator-1',
      payoutNet: '680.00',
    });
    executionAdapter.executeTransfer.mockRejectedValue(new Error('network timeout'));

    await processor.handle(job({ payoutObligationId: 'pay-1' }));

    expect(payoutObligationService.recordScheduledFailure).toHaveBeenCalledWith(
      'pay-1',
      'adapter_execution_error',
    );
  });

  // ---- US-35a scenario 2 analog: a redelivered/duplicate job is a no-op ----
  it('is a no-op when the obligation is no longer owed (already in_flight or settled)', async () => {
    obligationRepo.findOne.mockResolvedValue({
      id: 'pay-1',
      status: PayoutObligationStatus.IN_FLIGHT,
    });

    await processor.handle(job({ payoutObligationId: 'pay-1' }));

    expect(executionAdapter.executeTransfer).not.toHaveBeenCalled();
    expect(payoutObligationService.recordInstructed).not.toHaveBeenCalled();
    expect(payoutObligationService.recordScheduledFailure).not.toHaveBeenCalled();
  });

  it('is a no-op when the obligation no longer exists', async () => {
    obligationRepo.findOne.mockResolvedValue(undefined);

    await processor.handle(job({ payoutObligationId: 'missing' }));

    expect(executionAdapter.executeTransfer).not.toHaveBeenCalled();
  });
});
