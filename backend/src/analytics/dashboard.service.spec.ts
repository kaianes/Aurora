import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { CampaignState, IngestionStatus } from '../database/entities';

const mockRepo = () => ({
  findOne: vi.fn(),
  find: vi.fn().mockResolvedValue([]),
});

describe('DashboardService - US-21b', () => {
  let service: DashboardService;
  let campaignRepo: ReturnType<typeof mockRepo>;
  let poolMemberRepo: ReturnType<typeof mockRepo>;
  let opportunityRepo: ReturnType<typeof mockRepo>;
  let submissionRepo: ReturnType<typeof mockRepo>;
  let snapshotRepo: ReturnType<typeof mockRepo>;
  let aggregateRepo: ReturnType<typeof mockRepo>;
  let creatorRepo: ReturnType<typeof mockRepo>;

  beforeEach(() => {
    campaignRepo = mockRepo();
    poolMemberRepo = mockRepo();
    opportunityRepo = mockRepo();
    submissionRepo = mockRepo();
    snapshotRepo = mockRepo();
    aggregateRepo = mockRepo();
    creatorRepo = mockRepo();

    service = new DashboardService(
      campaignRepo as any,
      poolMemberRepo as any,
      opportunityRepo as any,
      submissionRepo as any,
      snapshotRepo as any,
      aggregateRepo as any,
      creatorRepo as any,
    );

    campaignRepo.findOne.mockResolvedValue({ id: 'camp-1', state: CampaignState.ACTIVE });
  });

  it('throws CAMPAIGN_NOT_FOUND when the campaign does not belong to the caller account', async () => {
    campaignRepo.findOne.mockResolvedValue(undefined);
    await expect(service.getDashboard('camp-1', 'acct-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  // ---- US-21b scenario 2: pending-delivery creators are distinct from
  // delivered ones, never shown with a zeroed, misleading figure ----
  it('shows a pending_delivery creator with null figures, never a fabricated zero', async () => {
    poolMemberRepo.find.mockResolvedValue([{ id: 'pm-1', campaignId: 'camp-1', creatorId: 'creator-1' }]);
    creatorRepo.findOne.mockResolvedValue({ id: 'creator-1', displayName: 'Duda' });
    opportunityRepo.findOne.mockResolvedValue(undefined); // no opportunity yet
    aggregateRepo.findOne.mockResolvedValue(undefined);

    const result = await service.getDashboard('camp-1', 'acct-1');

    expect(result.creators).toEqual([
      expect.objectContaining({
        creator_id: 'creator-1',
        status: 'pending_delivery',
        reach: null,
        engagement: null,
        impressions: null,
        ingestion_status: null,
      }),
    ]);
  });

  it('shows a delivered creator with her snapshot figures and ingestion status', async () => {
    poolMemberRepo.find.mockResolvedValue([{ id: 'pm-1', campaignId: 'camp-1', creatorId: 'creator-1' }]);
    creatorRepo.findOne.mockResolvedValue({ id: 'creator-1', displayName: 'Duda' });
    opportunityRepo.findOne.mockResolvedValue({ id: 'opp-1' });
    submissionRepo.findOne.mockResolvedValue({ id: 'sub-1', publishedAt: new Date() });
    snapshotRepo.findOne.mockResolvedValue({
      reach: 18400,
      engagement: 920,
      impressions: 41000,
      ingestionStatus: IngestionStatus.FRESH,
      lastSuccessfulPullAt: new Date('2026-10-21T06:00:00Z'),
    });
    aggregateRepo.findOne.mockResolvedValue({
      deliveredCreatorCount: 1,
      pendingDeliveryCreatorCount: 0,
      totalDeliveredReach: '18400',
      totalDeliveredEngagement: '920',
      totalDeliveredImpressions: '41000',
      anyStale: false,
      lastComputedAt: new Date('2026-10-21T06:00:00Z'),
    });

    const result = await service.getDashboard('camp-1', 'acct-1');

    expect(result.creators[0]).toEqual(
      expect.objectContaining({
        status: 'delivered',
        reach: 18400,
        engagement: 920,
        ingestion_status: IngestionStatus.FRESH,
      }),
    );
    expect(result.pool_aggregate.total_delivered_reach).toBe(18400);
  });

  // ---- US-21b scenario 3: the dashboard still renders, with stale figures
  // marked, rather than failing or blocking ----
  it('renders the pool aggregate with any_stale true when degraded, instead of failing to render', async () => {
    poolMemberRepo.find.mockResolvedValue([]);
    aggregateRepo.findOne.mockResolvedValue({
      deliveredCreatorCount: 3,
      pendingDeliveryCreatorCount: 1,
      totalDeliveredReach: '1000',
      totalDeliveredEngagement: '50',
      totalDeliveredImpressions: '2000',
      anyStale: true,
      lastComputedAt: new Date(),
    });

    const result = await service.getDashboard('camp-1', 'acct-1');

    expect(result.pool_aggregate.any_stale).toBe(true);
    expect(result.delivered_count).toBe(3);
    expect(result.pending_delivery_count).toBe(1);
  });
});
