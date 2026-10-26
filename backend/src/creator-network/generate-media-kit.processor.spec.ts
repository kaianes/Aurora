import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GenerateMediaKitProcessor } from './generate-media-kit.processor';
import { MediaKitExportStatus } from '../database/entities';

const mockRepo = () => ({
  findOne: vi.fn(),
  save: vi.fn((entity: any) => Promise.resolve(entity)),
});

describe('GenerateMediaKitProcessor - US-25 / ADR-0057', () => {
  let processor: GenerateMediaKitProcessor;
  let exportRepo: ReturnType<typeof mockRepo>;
  let creatorPerformanceService: { getCreatorDeliveredPerformance: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    exportRepo = mockRepo();
    creatorPerformanceService = { getCreatorDeliveredPerformance: vi.fn() };
    processor = new GenerateMediaKitProcessor(exportRepo as any, creatorPerformanceService as any);
  });

  it('marks ready with has_campaign_history=true when delivered performance exists', async () => {
    exportRepo.findOne.mockResolvedValue({ id: 'mk-1', creatorId: 'creator-1', status: MediaKitExportStatus.PENDING });
    creatorPerformanceService.getCreatorDeliveredPerformance.mockResolvedValue([
      { campaignId: 'camp-1', campaignName: 'Camp', publishedUrl: 'https://x', publishedAt: new Date(), reach: 100, engagement: 10, impressions: 200, ingestionStatus: 'fresh' },
    ]);

    await processor.handle({ data: { exportId: 'mk-1' } } as any);

    expect(exportRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: MediaKitExportStatus.READY, hasCampaignHistory: true }),
    );
  });

  // US-25 scenario 2: never fabricates campaign results not earned.
  it('marks ready with has_campaign_history=false when there is no delivered history', async () => {
    exportRepo.findOne.mockResolvedValue({ id: 'mk-2', creatorId: 'creator-1', status: MediaKitExportStatus.PENDING });
    creatorPerformanceService.getCreatorDeliveredPerformance.mockResolvedValue([]);

    await processor.handle({ data: { exportId: 'mk-2' } } as any);

    expect(exportRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: MediaKitExportStatus.READY, hasCampaignHistory: false }),
    );
  });

  // US-25 scenario 3
  it('marks failed with a reason when generation throws', async () => {
    exportRepo.findOne.mockResolvedValue({ id: 'mk-3', creatorId: 'creator-1', status: MediaKitExportStatus.PENDING });
    creatorPerformanceService.getCreatorDeliveredPerformance.mockRejectedValue(new Error('join failed'));

    await processor.handle({ data: { exportId: 'mk-3' } } as any);

    expect(exportRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: MediaKitExportStatus.FAILED, failureReason: 'render_error' }),
    );
  });
});
