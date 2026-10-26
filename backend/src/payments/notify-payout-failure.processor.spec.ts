import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotifyPayoutFailureProcessor } from './notify-payout-failure.processor';

const mockRepo = () => ({
  findOne: vi.fn(),
  save: vi.fn((entity: any) => Promise.resolve(entity)),
});

function job(data: any) {
  return { data } as any;
}

// US-35c (FR-46): Duda is told the specific reason within 24 hours, and the
// in-app visibility of that reason (US-36a) never depends on whether the
// outbound notification itself was ever delivered (scenario 3).
describe('NotifyPayoutFailureProcessor - US-35c', () => {
  let processor: NotifyPayoutFailureProcessor;
  let obligationRepo: ReturnType<typeof mockRepo>;
  let notificationAdapter: { notifyFailure: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    obligationRepo = mockRepo();
    notificationAdapter = { notifyFailure: vi.fn() };

    processor = new NotifyPayoutFailureProcessor(obligationRepo as any, notificationAdapter as any);
  });

  // ---- US-35c scenario 1: the specific reason is passed to the adapter ----
  it('notifies with the obligation\'s own last_failure_reason and marks the notification sent', async () => {
    const obligation: any = {
      id: 'pay-1',
      creatorId: 'creator-1',
      lastFailureReason: 'Chave Pix invalida informada pela criadora',
      failureNotificationSentAt: null,
    };
    obligationRepo.findOne.mockResolvedValue(obligation);
    notificationAdapter.notifyFailure.mockResolvedValue({ delivered: true });

    await processor.handle(job({ payoutObligationId: 'pay-1' }));

    expect(notificationAdapter.notifyFailure).toHaveBeenCalledWith({
      creatorId: 'creator-1',
      payoutObligationId: 'pay-1',
      reason: 'Chave Pix invalida informada pela criadora',
    });
    expect(obligation.failureNotificationSentAt).toBeInstanceOf(Date);
    expect(obligationRepo.save).toHaveBeenCalledWith(obligation);
  });

  // ---- US-35c scenario 3: the notification channel itself is unreachable ----
  it('still marks the notification as sent even when the adapter reports it was not delivered', async () => {
    const obligation: any = {
      id: 'pay-1',
      creatorId: 'creator-1',
      lastFailureReason: 'motivo da falha',
      failureNotificationSentAt: null,
    };
    obligationRepo.findOne.mockResolvedValue(obligation);
    notificationAdapter.notifyFailure.mockResolvedValue({ delivered: false });

    await processor.handle(job({ payoutObligationId: 'pay-1' }));

    expect(obligation.failureNotificationSentAt).toBeInstanceOf(Date);
  });

  // ---- US-35c scenario 3, harder case: the adapter call itself throws ----
  it('still marks the notification as sent when the adapter call throws entirely', async () => {
    const obligation: any = {
      id: 'pay-1',
      creatorId: 'creator-1',
      lastFailureReason: 'motivo da falha',
      failureNotificationSentAt: null,
    };
    obligationRepo.findOne.mockResolvedValue(obligation);
    notificationAdapter.notifyFailure.mockRejectedValue(new Error('email provider down'));

    await processor.handle(job({ payoutObligationId: 'pay-1' }));

    expect(obligation.failureNotificationSentAt).toBeInstanceOf(Date);
  });

  it('falls back to the job-provided reason if the obligation has none set yet (race with the write)', async () => {
    const obligation: any = {
      id: 'pay-1',
      creatorId: 'creator-1',
      lastFailureReason: null,
      failureNotificationSentAt: null,
    };
    obligationRepo.findOne.mockResolvedValue(obligation);
    notificationAdapter.notifyFailure.mockResolvedValue({ delivered: true });

    await processor.handle(job({ payoutObligationId: 'pay-1', reason: 'reason from job payload' }));

    expect(notificationAdapter.notifyFailure).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'reason from job payload' }),
    );
  });

  it('is a no-op when the obligation no longer exists', async () => {
    obligationRepo.findOne.mockResolvedValue(undefined);

    await processor.handle(job({ payoutObligationId: 'missing' }));

    expect(notificationAdapter.notifyFailure).not.toHaveBeenCalled();
    expect(obligationRepo.save).not.toHaveBeenCalled();
  });
});
