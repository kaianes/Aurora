import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MetricsIngestionService } from './metrics-ingestion.service';
import { IngestionAttemptOutcome, IngestionStatus } from '../database/entities';

const mockRepo = () => ({
  findOne: vi.fn(),
  find: vi.fn().mockResolvedValue([]),
  save: vi.fn((entity: any) => Promise.resolve({ id: entity.id || 'snap-1', ...entity })),
  create: vi.fn((data: any) => ({ ...data })),
});

describe('MetricsIngestionService - US-21a', () => {
  let service: MetricsIngestionService;
  let submissionRepo: ReturnType<typeof mockRepo>;
  let snapshotRepo: ReturnType<typeof mockRepo>;
  let attemptRepo: ReturnType<typeof mockRepo>;
  let aggregateRepo: ReturnType<typeof mockRepo>;
  let poolMemberRepo: ReturnType<typeof mockRepo>;
  let opportunityRepo: ReturnType<typeof mockRepo>;
  let campaignRepo: ReturnType<typeof mockRepo>;
  let adapter: { pullMetrics: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    submissionRepo = mockRepo();
    snapshotRepo = mockRepo();
    attemptRepo = mockRepo();
    aggregateRepo = mockRepo();
    poolMemberRepo = mockRepo();
    opportunityRepo = mockRepo();
    campaignRepo = mockRepo();
    adapter = { pullMetrics: vi.fn() };

    service = new MetricsIngestionService(
      submissionRepo as any,
      snapshotRepo as any,
      attemptRepo as any,
      aggregateRepo as any,
      poolMemberRepo as any,
      opportunityRepo as any,
      campaignRepo as any,
      adapter as any,
    );
  });

  // ---- US-21a scenario 1: a newly published submission is discovered and
  // attributed unambiguously to its creator and campaign ----
  it('discovers a published submission with no snapshot yet and creates one, pending_first_pull', async () => {
    submissionRepo.find.mockResolvedValue([
      {
        id: 'sub-1',
        campaignId: 'camp-1',
        creatorId: 'creator-1',
        opportunityId: 'opp-1',
        publishedAt: new Date(),
        publishedUrl: 'https://instagram.com/p/abc',
      },
    ]);
    snapshotRepo.findOne.mockResolvedValue(undefined); // no existing snapshot
    opportunityRepo.findOne.mockResolvedValue({ deliverable: { format: 'instagram_reel' } });
    adapter.pullMetrics.mockResolvedValue({ outcome: 'success', reach: 100, engagement: 10, impressions: 200 });

    await service.runDiscoveryAndIngestion();

    expect(snapshotRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        contentSubmissionId: 'sub-1',
        campaignId: 'camp-1',
        creatorId: 'creator-1',
        platform: 'instagram',
        ingestionStatus: IngestionStatus.PENDING_FIRST_PULL,
      }),
    );
  });

  it('never creates a second snapshot for a submission that already has one', async () => {
    submissionRepo.find.mockResolvedValue([
      { id: 'sub-1', campaignId: 'camp-1', creatorId: 'creator-1', publishedAt: new Date() },
    ]);
    snapshotRepo.findOne.mockResolvedValueOnce({ id: 'snap-1' }); // discovery check: already exists
    snapshotRepo.find.mockResolvedValue([]); // no due snapshots to pull this cycle

    await service.runDiscoveryAndIngestion();

    expect(snapshotRepo.save).not.toHaveBeenCalled();
  });

  // ---- US-21a scenario 2: rate limiting/outage retries with backoff and
  // never blanks last-known figures ----
  it('on rate_limited, marks the snapshot stale without blanking last-known figures', async () => {
    const snapshot = {
      id: 'snap-1',
      contentSubmissionId: 'sub-1',
      campaignId: 'camp-1',
      creatorId: 'creator-1',
      platform: 'instagram',
      reach: 500,
      engagement: 50,
      impressions: 900,
      ingestionStatus: IngestionStatus.FRESH,
      consecutiveFailureCount: 0,
    };
    submissionRepo.find.mockResolvedValue([]); // nothing new to discover
    snapshotRepo.find.mockResolvedValue([snapshot]);
    submissionRepo.findOne.mockResolvedValue({ id: 'sub-1', publishedUrl: 'https://instagram.com/p/abc' });
    adapter.pullMetrics.mockResolvedValue({ outcome: 'rate_limited' });
    aggregateRepo.findOne.mockResolvedValue(undefined);
    poolMemberRepo.find.mockResolvedValue([]);

    await service.runDiscoveryAndIngestion();

    const savedSnapshot = snapshotRepo.save.mock.calls[0][0];
    expect(savedSnapshot.ingestionStatus).toBe(IngestionStatus.STALE_RATE_LIMITED);
    expect(savedSnapshot.reach).toBe(500); // untouched, last-known value preserved
    expect(savedSnapshot.engagement).toBe(50);
    expect(savedSnapshot.consecutiveFailureCount).toBe(1);
    expect(attemptRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: IngestionAttemptOutcome.RATE_LIMITED }),
    );
  });

  // ---- US-21a scenario 3: auth revocation is logged distinctly from a
  // transient failure and backs off for 24 hours ----
  it('on auth_revoked, marks the snapshot distinctly and schedules a 24-hour retry', async () => {
    const snapshot = {
      id: 'snap-1',
      contentSubmissionId: 'sub-1',
      campaignId: 'camp-1',
      creatorId: 'creator-1',
      platform: 'instagram',
      reach: 500,
      engagement: 50,
      impressions: 900,
      ingestionStatus: IngestionStatus.FRESH,
      consecutiveFailureCount: 0,
    };
    submissionRepo.find.mockResolvedValue([]);
    snapshotRepo.find.mockResolvedValue([snapshot]);
    submissionRepo.findOne.mockResolvedValue({ id: 'sub-1', publishedUrl: 'https://instagram.com/p/abc' });
    adapter.pullMetrics.mockResolvedValue({ outcome: 'auth_revoked' });
    aggregateRepo.findOne.mockResolvedValue(undefined);
    poolMemberRepo.find.mockResolvedValue([]);

    const before = Date.now();
    await service.runDiscoveryAndIngestion();

    const savedSnapshot = snapshotRepo.save.mock.calls[0][0];
    expect(savedSnapshot.ingestionStatus).toBe(IngestionStatus.STALE_AUTH_REVOKED);
    expect(savedSnapshot.nextRetryAt.getTime()).toBeGreaterThan(before + 23 * 60 * 60 * 1000);
    expect(attemptRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: IngestionAttemptOutcome.AUTH_REVOKED }),
    );
  });

  // ---- recomputeAggregate: delivered-only totals, pending vs delivered
  // partition (US-21b scenario 2's underlying data source) ----
  it('recomputes the aggregate from delivered creators only, leaving pending creators out of totals', async () => {
    poolMemberRepo.find.mockResolvedValue([
      { id: 'pm-1', campaignId: 'camp-1', creatorId: 'creator-1' },
      { id: 'pm-2', campaignId: 'camp-1', creatorId: 'creator-2' },
    ]);
    opportunityRepo.findOne.mockImplementation(({ where }: any) =>
      where.creatorId === 'creator-1' ? Promise.resolve({ id: 'opp-1' }) : Promise.resolve(undefined),
    );
    submissionRepo.findOne.mockResolvedValue({ id: 'sub-1' });
    snapshotRepo.findOne.mockResolvedValue({
      reach: 1000,
      engagement: 50,
      impressions: 2000,
      ingestionStatus: IngestionStatus.FRESH,
    });
    aggregateRepo.findOne.mockResolvedValue(undefined);

    await service.recomputeAggregate('camp-1');

    const saved = aggregateRepo.save.mock.calls[0][0];
    expect(saved.deliveredCreatorCount).toBe(1);
    expect(saved.pendingDeliveryCreatorCount).toBe(1);
    expect(saved.totalDeliveredReach).toBe('1000');
    expect(saved.totalDeliveredEngagement).toBe('50');
    expect(saved.anyStale).toBe(false);
  });
});
