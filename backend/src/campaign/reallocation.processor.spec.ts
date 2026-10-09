import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReallocationProcessor } from './reallocation.processor';
import {
  CampaignState,
  PoolMemberStatus,
  ReallocationOutcome,
} from '../database/entities';

const mockRepo = () => ({
  findOne: vi.fn(),
  find: vi.fn(),
  create: vi.fn((data: any) => ({ ...data })),
  save: vi.fn((entity: any) => Promise.resolve(entity)),
});

function member(id: string, overrides: Partial<any> = {}) {
  return {
    id,
    campaignId: 'camp-1',
    creatorId: `creator-${id}`,
    allocatedBudget: '500.00',
    originalBudget: '500.00',
    committedBudget: '0.00',
    status: PoolMemberStatus.PENDING_PUBLISH,
    ...overrides,
  };
}

describe('ReallocationProcessor - US-10', () => {
  let processor: ReallocationProcessor;
  let campaignRepo: ReturnType<typeof mockRepo>;
  let poolMemberRepo: ReturnType<typeof mockRepo>;
  let boundsRepo: ReturnType<typeof mockRepo>;
  let eventRepo: ReturnType<typeof mockRepo>;

  beforeEach(() => {
    campaignRepo = mockRepo();
    poolMemberRepo = mockRepo();
    boundsRepo = mockRepo();
    eventRepo = mockRepo();

    processor = new ReallocationProcessor(
      campaignRepo as any,
      poolMemberRepo as any,
      boundsRepo as any,
      eventRepo as any,
    );
  });

  function runJob(data: any) {
    return processor.handleReallocateBudget({ data } as any);
  }

  // ---- US-10 scenario 1: reallocation within configured bounds, recorded in history ----
  it('reallocates remaining budget toward the better performer within bounds and logs an applied event', async () => {
    campaignRepo.findOne.mockResolvedValue({ id: 'camp-1', state: CampaignState.ACTIVE });
    boundsRepo.findOne.mockResolvedValue({ enabled: true, maxShiftPct: '20', minGuaranteedSharePct: '50' });
    const memberA = member('a', { allocatedBudget: '500.00', originalBudget: '500.00' });
    const memberB = member('b', { allocatedBudget: '500.00', originalBudget: '500.00' });
    poolMemberRepo.find.mockResolvedValue([memberA, memberB]);

    await runJob({
      campaignId: 'camp-1',
      metricsFeedAvailable: true,
      performance: [
        { poolMemberId: 'a', score: 90 },
        { poolMemberId: 'b', score: 10 },
      ],
    });

    expect(poolMemberRepo.save).toHaveBeenCalled();
    const savedMembers = poolMemberRepo.save.mock.calls[0][0];
    const savedA = savedMembers.find((m: any) => m.id === 'a');
    const savedB = savedMembers.find((m: any) => m.id === 'b');
    // Better performer (a) should end up with a larger allocation than the
    // underperformer (b), and the shift should not exceed the 20% bound.
    expect(parseFloat(savedA.allocatedBudget)).toBeGreaterThan(parseFloat(savedB.allocatedBudget));
    expect(parseFloat(savedA.allocatedBudget)).toBeLessThanOrEqual(500 * 1.2 + 0.01);

    expect(eventRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: ReallocationOutcome.APPLIED, campaignId: 'camp-1' }),
    );
  });

  // ---- US-10 scenario 2: creators with no performance data are left untouched,
  // not penalized, and committed (already-published) budget is never reduced ----
  it('leaves not-yet-published creators with no performance data completely untouched', async () => {
    campaignRepo.findOne.mockResolvedValue({ id: 'camp-1', state: CampaignState.ACTIVE });
    boundsRepo.findOne.mockResolvedValue({ enabled: true, maxShiftPct: '20', minGuaranteedSharePct: '50' });
    const memberA = member('a', { allocatedBudget: '500.00', originalBudget: '500.00' });
    const memberB = member('b', { allocatedBudget: '500.00', originalBudget: '500.00' });
    const memberNoData = member('c', { allocatedBudget: '500.00', originalBudget: '500.00' });
    poolMemberRepo.find.mockResolvedValue([memberA, memberB, memberNoData]);

    await runJob({
      campaignId: 'camp-1',
      metricsFeedAvailable: true,
      performance: [
        { poolMemberId: 'a', score: 90 },
        { poolMemberId: 'b', score: 10 },
      ],
    });

    const savedMembers = poolMemberRepo.save.mock.calls[0][0];
    // Member 'c' (no performance data) must not even appear in the save batch.
    expect(savedMembers.find((m: any) => m.id === 'c')).toBeUndefined();
  });

  // ---- US-10 scenario 2 (committed budget guard): a pool member whose entire
  // allocation is already committed (published) is skipped entirely ----
  it('does not touch a pool member whose remaining (uncommitted) budget is zero', async () => {
    campaignRepo.findOne.mockResolvedValue({ id: 'camp-1', state: CampaignState.ACTIVE });
    boundsRepo.findOne.mockResolvedValue({ enabled: true, maxShiftPct: '20', minGuaranteedSharePct: '50' });
    const fullyCommitted = member('a', { allocatedBudget: '500.00', committedBudget: '500.00', originalBudget: '500.00' });
    const other = member('b', { allocatedBudget: '500.00', originalBudget: '500.00' });
    poolMemberRepo.find.mockResolvedValue([fullyCommitted, other]);

    await runJob({
      campaignId: 'camp-1',
      metricsFeedAvailable: true,
      performance: [
        { poolMemberId: 'a', score: 10 },
        { poolMemberId: 'b', score: 90 },
      ],
    });

    const savedMembers = poolMemberRepo.save.mock.calls[0][0];
    expect(savedMembers.find((m: any) => m.id === 'a')).toBeUndefined();
  });

  // ---- US-10 scenario 3: stale/unavailable metrics feed skips the cycle,
  // leaves budget unchanged, and logs the skip (this is a documented
  // deferral: metricsFeedAvailable is always false today since no real feed
  // exists, but the skip behavior itself is in scope for E2 and must work) ----
  it('skips reallocation and logs skipped_stale_metrics when the metrics feed is unavailable', async () => {
    campaignRepo.findOne.mockResolvedValue({ id: 'camp-1', state: CampaignState.ACTIVE });
    boundsRepo.findOne.mockResolvedValue({ enabled: true, maxShiftPct: '20', minGuaranteedSharePct: '50' });

    await runJob({ campaignId: 'camp-1', metricsFeedAvailable: false });

    expect(poolMemberRepo.save).not.toHaveBeenCalled();
    expect(eventRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: ReallocationOutcome.SKIPPED_STALE_METRICS }),
    );
  });

  // ---- US-10 scenario 3 (failure variant): fewer than 2 members with
  // sufficient data means nothing can be compared; skip with no_data outcome,
  // and the campaign's budget must remain unchanged (no save calls at all) ----
  it('skips with skipped_no_data when fewer than two members have performance data, and never drops a creator', async () => {
    campaignRepo.findOne.mockResolvedValue({ id: 'camp-1', state: CampaignState.ACTIVE });
    boundsRepo.findOne.mockResolvedValue({ enabled: true, maxShiftPct: '20', minGuaranteedSharePct: '50' });
    poolMemberRepo.find.mockResolvedValue([member('a'), member('b')]);

    await runJob({
      campaignId: 'camp-1',
      metricsFeedAvailable: true,
      performance: [{ poolMemberId: 'a', score: 50 }],
    });

    expect(poolMemberRepo.save).not.toHaveBeenCalled();
    expect(eventRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: ReallocationOutcome.SKIPPED_NO_DATA }),
    );
  });

  // ---- Reallocation never runs for a campaign that is not active, or when
  // bounds are disabled (opt-in default per ADR-0007) ----
  it('does nothing when the campaign is not active', async () => {
    campaignRepo.findOne.mockResolvedValue({ id: 'camp-1', state: CampaignState.PAUSED });

    await runJob({ campaignId: 'camp-1', metricsFeedAvailable: true, performance: [] });

    expect(boundsRepo.findOne).not.toHaveBeenCalled();
    expect(eventRepo.save).not.toHaveBeenCalled();
  });

  it('does nothing when reallocation bounds are disabled', async () => {
    campaignRepo.findOne.mockResolvedValue({ id: 'camp-1', state: CampaignState.ACTIVE });
    boundsRepo.findOne.mockResolvedValue({ enabled: false, maxShiftPct: '20', minGuaranteedSharePct: '50' });

    await runJob({ campaignId: 'camp-1', metricsFeedAvailable: true, performance: [] });

    expect(eventRepo.save).not.toHaveBeenCalled();
  });

  // ---- ADR-0007 floor: a creator's remaining allocation can never be
  // reduced below min_guaranteed_share_pct of their original allocation ----
  it('never reduces a creator below the configured minimum guaranteed share of their original budget', async () => {
    campaignRepo.findOne.mockResolvedValue({ id: 'camp-1', state: CampaignState.ACTIVE });
    boundsRepo.findOne.mockResolvedValue({ enabled: true, maxShiftPct: '30', minGuaranteedSharePct: '90' });
    const memberA = member('a', { allocatedBudget: '1000.00', originalBudget: '1000.00' });
    const memberB = member('b', { allocatedBudget: '1000.00', originalBudget: '1000.00' });
    poolMemberRepo.find.mockResolvedValue([memberA, memberB]);

    await runJob({
      campaignId: 'camp-1',
      metricsFeedAvailable: true,
      performance: [
        { poolMemberId: 'a', score: 100 },
        { poolMemberId: 'b', score: 1 },
      ],
    });

    const savedMembers = poolMemberRepo.save.mock.calls[0][0];
    const savedB = savedMembers.find((m: any) => m.id === 'b');
    // Floor is 90% of 1000 = 900.
    expect(parseFloat(savedB.allocatedBudget)).toBeGreaterThanOrEqual(900 - 0.01);
  });
});
