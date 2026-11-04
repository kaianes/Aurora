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
  let campaignRepo: ReturnType<typeof mockRepo> & { save: ReturnType<typeof vi.fn> };
  let boundsRepo: ReturnType<typeof mockRepo>;
  let campaignQueue: { add: ReturnType<typeof vi.fn> };
  let performanceScoringService: { getReallocationInputs: ReturnType<typeof vi.fn> };
  let transitionRepo: { create: ReturnType<typeof vi.fn>; save: ReturnType<typeof vi.fn> };
  let auditService: { log: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    quoteRepo = mockRepo();
    campaignRepo = { ...mockRepo(), save: vi.fn((c: any) => Promise.resolve(c)) };
    boundsRepo = mockRepo();
    campaignQueue = { add: vi.fn() };
    performanceScoringService = { getReallocationInputs: vi.fn() };
    transitionRepo = { create: vi.fn((data: any) => data), save: vi.fn().mockResolvedValue(undefined) };
    auditService = { log: vi.fn().mockResolvedValue(undefined) };

    service = new CampaignScheduledTasksService(
      quoteRepo as any,
      campaignRepo as any,
      boundsRepo as any,
      campaignQueue as any,
      performanceScoringService as any,
      transitionRepo as any,
      auditService as any,
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

  // E2 architecture section 2.6: confirmed -> active, "launch date reached
  // (scheduled job)" half -- CampaignService.confirm() itself covers
  // "immediate launch if timeline_start <= now" (see campaign.service.spec.ts).
  describe('activateDueCampaigns', () => {
    it('activates every confirmed campaign whose timeline_start has been reached, with no actor', async () => {
      campaignRepo.find.mockResolvedValue([
        { id: 'camp-1', accountId: 'acct-1', state: CampaignState.CONFIRMED, timelineStart: new Date('2026-01-01') },
      ]);

      await service.activateDueCampaigns();

      expect(campaignRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'camp-1', state: CampaignState.ACTIVE }),
      );
      expect(transitionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          campaignId: 'camp-1',
          fromState: CampaignState.CONFIRMED,
          toState: CampaignState.ACTIVE,
          actorUserId: null,
        }),
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: null,
          targetAccountId: 'acct-1',
          action: 'campaign.activated',
        }),
      );
    });

    it('does nothing when no confirmed campaign is due', async () => {
      campaignRepo.find.mockResolvedValue([]);

      await service.activateDueCampaigns();

      expect(campaignRepo.save).not.toHaveBeenCalled();
      expect(auditService.log).not.toHaveBeenCalled();
    });
  });
});
