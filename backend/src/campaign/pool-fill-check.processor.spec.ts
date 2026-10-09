import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PoolFillCheckProcessor } from './pool-fill-check.processor';

const mockRepo = () => ({
  findOne: vi.fn(),
  count: vi.fn(),
});

describe('PoolFillCheckProcessor - US-07 scenario 3', () => {
  let processor: PoolFillCheckProcessor;
  let campaignRepo: ReturnType<typeof mockRepo>;
  let poolMemberRepo: ReturnType<typeof mockRepo>;
  let campaignService: { recordShortfall: ReturnType<typeof vi.fn> };
  let auditService: { log: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    campaignRepo = mockRepo();
    poolMemberRepo = mockRepo();
    campaignService = { recordShortfall: vi.fn() };
    auditService = { log: vi.fn().mockResolvedValue(undefined) };

    processor = new PoolFillCheckProcessor(
      campaignRepo as any,
      poolMemberRepo as any,
      campaignService as any,
      auditService as any,
    );
  });

  function runJob(campaignId = 'camp-1') {
    return processor.handlePoolFillCheck({ data: { campaignId } } as any);
  }

  // ---- Normal: guarantee is met, no shortfall is raised, no notification sent ----
  it('does nothing when the actual pool size meets the guaranteed minimum', async () => {
    campaignRepo.findOne.mockResolvedValue({
      id: 'camp-1',
      guaranteedMinPoolSize: 20,
      lockedPrice: '10000.00',
      accountId: 'account-1',
    });
    poolMemberRepo.count.mockResolvedValue(20);

    await runJob();

    expect(campaignService.recordShortfall).not.toHaveBeenCalled();
    expect(auditService.log).not.toHaveBeenCalled();
  });

  // ---- Hard: pool exceeds the guarantee, still a no-op ----
  it('does nothing when the actual pool size exceeds the guaranteed minimum', async () => {
    campaignRepo.findOne.mockResolvedValue({
      id: 'camp-1',
      guaranteedMinPoolSize: 20,
      lockedPrice: '10000.00',
      accountId: 'account-1',
    });
    poolMemberRepo.count.mockResolvedValue(25);

    await runJob();

    expect(campaignService.recordShortfall).not.toHaveBeenCalled();
  });

  // ---- Failure: pool falls short of the guarantee -- Marina must be told
  // before launch and a shortfall resolution is created and audited ----
  it('records a shortfall and writes an audit log when the pool falls short of the guarantee', async () => {
    campaignRepo.findOne.mockResolvedValue({
      id: 'camp-1',
      guaranteedMinPoolSize: 20,
      lockedPrice: '10000.00',
      accountId: 'account-1',
    });
    poolMemberRepo.count.mockResolvedValue(14);
    campaignService.recordShortfall.mockResolvedValue({ id: 'shortfall-1' });

    await runJob();

    expect(campaignService.recordShortfall).toHaveBeenCalledWith('camp-1', 20, 14, '10000.00');
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'campaign.shortfall_detected' }),
    );
  });

  // ---- Edge: a campaign that was never confirmed (no guaranteedMinPoolSize
  // or lockedPrice yet) is skipped safely, not crashed on ----
  it('does nothing for a campaign that has not been confirmed yet', async () => {
    campaignRepo.findOne.mockResolvedValue({ id: 'camp-1', guaranteedMinPoolSize: null, lockedPrice: null });

    await runJob();

    expect(poolMemberRepo.count).not.toHaveBeenCalled();
    expect(campaignService.recordShortfall).not.toHaveBeenCalled();
  });

  it('does nothing when the campaign no longer exists', async () => {
    campaignRepo.findOne.mockResolvedValue(null);

    await runJob();

    expect(poolMemberRepo.count).not.toHaveBeenCalled();
  });
});
