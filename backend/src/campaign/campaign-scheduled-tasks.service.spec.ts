import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CampaignScheduledTasksService } from './campaign-scheduled-tasks.service';
import { CampaignState } from '../database/entities';

const mockRepo = () => ({
  find: vi.fn().mockResolvedValue([]),
  update: vi.fn().mockResolvedValue({ affected: 0 }),
});

describe('CampaignScheduledTasksService.scheduleReallocation - ADR-0047', () => {
  let service: CampaignScheduledTasksService;
  let quoteRepo: ReturnType<typeof mockRepo>;
  let campaignRepo: ReturnType<typeof mockRepo>;
  let boundsRepo: ReturnType<typeof mockRepo>;
  let campaignQueue: { add: ReturnType<typeof vi.fn> };
  let performanceScoringService: { getReallocationInputs: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    quoteRepo = mockRepo();
    campaignRepo = mockRepo();
    boundsRepo = mockRepo();
    campaignQueue = { add: vi.fn() };
    performanceScoringService = { getReallocationInputs: vi.fn() };

    service = new CampaignScheduledTasksService(
      quoteRepo as any,
      campaignRepo as any,
      boundsRepo as any,
      campaignQueue as any,
      performanceScoringService as any,
    );
  });

  // ADR-0047: the hardcoded metricsFeedAvailable: false, performance: []
  // literals are replaced with a real call into E7's exported service.
  it('enqueues reallocate-budget with the real metricsFeedAvailable/performance from PerformanceScoringService', async () => {
    boundsRepo.find.mockResolvedValue([{ campaignId: 'camp-1', enabled: true }]);
    campaignRepo.find.mockResolvedValue([{ id: 'camp-1', state: CampaignState.ACTIVE }]);
    performanceScoringService.getReallocationInputs.mockResolvedValue({
      metricsFeedAvailable: true,
      performance: [{ poolMemberId: 'pm-1', score: 42 }],
    });

    await service.scheduleReallocation();

    expect(performanceScoringService.getReallocationInputs).toHaveBeenCalledWith('camp-1');
    expect(campaignQueue.add).toHaveBeenCalledWith('reallocate-budget', {
      campaignId: 'camp-1',
      metricsFeedAvailable: true,
      performance: [{ poolMemberId: 'pm-1', score: 42 }],
    });
  });

  it('never calls into the scoring service for a campaign that is not active', async () => {
    boundsRepo.find.mockResolvedValue([{ campaignId: 'camp-1', enabled: true }]);
    campaignRepo.find.mockResolvedValue([]); // no active campaigns

    await service.scheduleReallocation();

    expect(performanceScoringService.getReallocationInputs).not.toHaveBeenCalled();
    expect(campaignQueue.add).not.toHaveBeenCalled();
  });
});
