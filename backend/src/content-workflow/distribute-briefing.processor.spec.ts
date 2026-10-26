import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DistributeBriefingProcessor } from './distribute-briefing.processor';
import { DistributionRecipientStatus } from '../database/entities';

const mockRepo = () => ({
  find: vi.fn().mockResolvedValue([]),
  save: vi.fn((entity: any) => Promise.resolve({ ...entity })),
});

describe('DistributeBriefingProcessor - US-18b', () => {
  let processor: DistributeBriefingProcessor;
  let recipientRepo: ReturnType<typeof mockRepo>;
  let adapter: { deliver: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    recipientRepo = mockRepo();
    adapter = { deliver: vi.fn() };
    processor = new DistributeBriefingProcessor(recipientRepo as any, adapter as any);
  });

  it('marks each recipient delivered or failed, never silently dropping a failure (US-18b scenario 3)', async () => {
    recipientRepo.find.mockResolvedValue([
      { id: 'rec-1', creatorId: 'creator-1', status: DistributionRecipientStatus.PENDING },
      { id: 'rec-2', creatorId: 'creator-2', status: DistributionRecipientStatus.PENDING },
    ]);
    adapter.deliver
      .mockResolvedValueOnce({ delivered: true })
      .mockResolvedValueOnce({ delivered: false, failureReason: 'no_contact_channel' });

    await processor.handleDistributeBriefing({ data: { briefingId: 'brf-1', campaignId: 'camp-1' } } as any);

    expect(recipientRepo.save).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ status: DistributionRecipientStatus.DELIVERED }),
    );
    expect(recipientRepo.save).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ status: DistributionRecipientStatus.FAILED, failureReason: 'no_contact_channel' }),
    );
  });

  it('records a failure when the adapter itself throws, rather than leaving the row pending', async () => {
    recipientRepo.find.mockResolvedValue([
      { id: 'rec-1', creatorId: 'creator-1', status: DistributionRecipientStatus.PENDING },
    ]);
    adapter.deliver.mockRejectedValue(new Error('provider down'));

    await processor.handleDistributeBriefing({ data: { briefingId: 'brf-1', campaignId: 'camp-1' } } as any);

    expect(recipientRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: DistributionRecipientStatus.FAILED }),
    );
  });
});
