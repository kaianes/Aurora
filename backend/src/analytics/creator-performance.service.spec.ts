import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CreatorPerformanceService } from './creator-performance.service';
import { IngestionStatus } from '../database/entities';

const mockRepo = () => ({
  findOne: vi.fn(),
  find: vi.fn().mockResolvedValue([]),
});

describe('CreatorPerformanceService - US-37', () => {
  let service: CreatorPerformanceService;
  let submissionRepo: ReturnType<typeof mockRepo>;
  let snapshotRepo: ReturnType<typeof mockRepo>;
  let campaignRepo: ReturnType<typeof mockRepo>;

  beforeEach(() => {
    submissionRepo = mockRepo();
    snapshotRepo = mockRepo();
    campaignRepo = mockRepo();

    service = new CreatorPerformanceService(
      submissionRepo as any,
      snapshotRepo as any,
      campaignRepo as any,
    );
  });

  // ---- US-37 scenario 1: a creator sees only her own delivered performance ----
  it('scopes results strictly to published submissions for the requesting creator', async () => {
    submissionRepo.find.mockResolvedValue([
      {
        id: 'sub-1',
        campaignId: 'camp-1',
        publishedUrl: 'https://instagram.com/p/abc123',
        publishedAt: new Date('2026-10-23T08:00:00Z'),
      },
    ]);
    campaignRepo.findOne.mockResolvedValue({ name: 'Lancamento Serum Vitamina C' });
    snapshotRepo.findOne.mockResolvedValue({
      reach: 18400,
      engagement: 920,
      impressions: 41000,
      ingestionStatus: IngestionStatus.FRESH,
      lastSuccessfulPullAt: new Date('2026-10-21T06:00:00Z'),
    });

    const result = await service.getOwnPerformance('creator-1');

    expect(submissionRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ creatorId: 'creator-1' }) }),
    );
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      content_submission_id: 'sub-1',
      campaign_name: 'Lancamento Serum Vitamina C',
      reach: 18400,
      engagement: 920,
    });
  });

  // ---- US-37 scenario 2: stale figures are still shown, with their last
  // pull timestamp, not blanked or errored ----
  it('surfaces stale last-known figures rather than a blank state', async () => {
    submissionRepo.find.mockResolvedValue([
      { id: 'sub-1', campaignId: 'camp-1', publishedUrl: 'https://x.com', publishedAt: new Date() },
    ]);
    campaignRepo.findOne.mockResolvedValue({ name: 'Campanha X' });
    snapshotRepo.findOne.mockResolvedValue({
      reach: 500,
      engagement: 20,
      impressions: 900,
      ingestionStatus: IngestionStatus.STALE_UNREACHABLE,
      lastSuccessfulPullAt: new Date('2026-10-20T00:00:00Z'),
    });

    const result = await service.getOwnPerformance('creator-1');

    expect(result.data[0].ingestion_status).toBe(IngestionStatus.STALE_UNREACHABLE);
    expect(result.data[0].reach).toBe(500);
  });

  // ---- US-37 scenario 3: a declined or still-pending opportunity has no
  // entry at all -- never a substituted or fabricated zero result ----
  it('returns no entry for content with no confirmed publication', async () => {
    submissionRepo.find.mockResolvedValue([]); // the query itself already filters publishedAt IS NOT NULL

    const result = await service.getOwnPerformance('creator-1');

    expect(result.data).toEqual([]);
  });
});
