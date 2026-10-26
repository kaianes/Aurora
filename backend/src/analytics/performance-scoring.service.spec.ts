import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PerformanceScoringService } from './performance-scoring.service';
import { IngestionStatus } from '../database/entities';

const mockRepo = () => ({
  findOne: vi.fn(),
  find: vi.fn().mockResolvedValue([]),
});

describe('PerformanceScoringService - ADR-0047', () => {
  let service: PerformanceScoringService;
  let poolMemberRepo: ReturnType<typeof mockRepo>;
  let opportunityRepo: ReturnType<typeof mockRepo>;
  let submissionRepo: ReturnType<typeof mockRepo>;
  let snapshotRepo: ReturnType<typeof mockRepo>;

  beforeEach(() => {
    poolMemberRepo = mockRepo();
    opportunityRepo = mockRepo();
    submissionRepo = mockRepo();
    snapshotRepo = mockRepo();

    service = new PerformanceScoringService(
      poolMemberRepo as any,
      opportunityRepo as any,
      submissionRepo as any,
      snapshotRepo as any,
    );
  });

  it('reports metricsFeedAvailable false when zero pool members have any fresh data', async () => {
    poolMemberRepo.find.mockResolvedValue([{ id: 'pm-1', creatorId: 'creator-1' }]);
    opportunityRepo.findOne.mockResolvedValue(undefined);

    const result = await service.getReallocationInputs('camp-1');

    expect(result.metricsFeedAvailable).toBe(false);
    expect(result.performance).toEqual([]);
  });

  it('reports metricsFeedAvailable true when at least one member has fresh data, even if others are stale', async () => {
    poolMemberRepo.find.mockResolvedValue([
      { id: 'pm-fresh', creatorId: 'creator-1' },
      { id: 'pm-stale', creatorId: 'creator-2' },
    ]);
    opportunityRepo.findOne.mockImplementation(({ where }: any) =>
      Promise.resolve({ id: `opp-${where.creatorId}` }),
    );
    submissionRepo.find.mockImplementation(({ where }: any) =>
      Promise.resolve([{ id: `sub-${where.opportunityId}` }]),
    );
    snapshotRepo.findOne.mockImplementation(({ where }: any) => {
      if (where.contentSubmissionId === 'sub-opp-creator-1') {
        return Promise.resolve({ ingestionStatus: IngestionStatus.FRESH, engagement: 90 });
      }
      return Promise.resolve({ ingestionStatus: IngestionStatus.STALE_RATE_LIMITED, engagement: 10 });
    });

    const result = await service.getReallocationInputs('camp-1');

    expect(result.metricsFeedAvailable).toBe(true);
    expect(result.performance).toEqual([{ poolMemberId: 'pm-fresh', score: 90 }]);
  });

  it('leaves a not-yet-published pool member entirely out of the performance array', async () => {
    poolMemberRepo.find.mockResolvedValue([{ id: 'pm-1', creatorId: 'creator-1' }]);
    opportunityRepo.findOne.mockResolvedValue(undefined); // no opportunity -> not yet published

    const result = await service.getReallocationInputs('camp-1');

    expect(result.performance.find((p) => p.poolMemberId === 'pm-1')).toBeUndefined();
  });
});
