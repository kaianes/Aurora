import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GoneException, NotFoundException } from '@nestjs/common';
import { OpportunityService } from './opportunity.service';
import { OpportunityStatus } from '../database/entities';

const mockRepo = () => ({
  find: vi.fn().mockResolvedValue([]),
  findOne: vi.fn(),
  save: vi.fn((entity: any) => Promise.resolve({ ...entity })),
  update: vi.fn().mockResolvedValue({ affected: 1 }),
});

describe('OpportunityService - US-28', () => {
  let service: OpportunityService;
  let opportunityRepo: ReturnType<typeof mockRepo>;
  let entryRepo: ReturnType<typeof mockRepo>;
  let campaignRepo: ReturnType<typeof mockRepo>;
  let accountRepo: ReturnType<typeof mockRepo>;
  let auditService: { log: ReturnType<typeof vi.fn> };
  const actor = { ipAddress: '127.0.0.1', userAgent: 'vitest' };

  beforeEach(() => {
    opportunityRepo = mockRepo();
    entryRepo = mockRepo();
    campaignRepo = mockRepo();
    accountRepo = mockRepo();
    auditService = { log: vi.fn().mockResolvedValue(undefined) };

    service = new OpportunityService(
      opportunityRepo as any,
      entryRepo as any,
      campaignRepo as any,
      accountRepo as any,
      auditService as any,
    );
  });

  // ---- US-28 scenario 1: Duda accepts an opportunity before expiry ----
  it('accepts a pending opportunity before its expiry', async () => {
    const future = new Date(Date.now() + 60_000);
    opportunityRepo.findOne.mockResolvedValue({
      id: 'opp-1', creatorId: 'creator-1', status: OpportunityStatus.PENDING,
      expiresAt: future, shortlistEntryId: 'entry-1',
      payoutGross: '800.00', payoutCommission: '120.00', payoutNet: '680.00',
      deliverable: { format: 'instagram_reel', quantity: 1 }, campaignId: 'camp-1',
    });
    entryRepo.findOne.mockResolvedValue({ id: 'entry-1', included: true });

    const result = await service.accept('opp-1', 'creator-1', actor);

    expect(result.status).toBe(OpportunityStatus.ACCEPTED);
    expect(result.note).toBeUndefined();
    expect(auditService.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'opportunity.accepted' }));
  });

  // ---- US-28 scenario 2: Duda declines an opportunity ----
  it('declines a pending opportunity and removes the creator from the active pool', async () => {
    const future = new Date(Date.now() + 60_000);
    opportunityRepo.findOne.mockResolvedValue({
      id: 'opp-1', creatorId: 'creator-1', status: OpportunityStatus.PENDING,
      expiresAt: future, shortlistEntryId: 'entry-1', campaignId: 'camp-1',
    });

    const result = await service.decline('opp-1', 'creator-1', actor);

    expect(result.status).toBe(OpportunityStatus.DECLINED);
    expect(entryRepo.update).toHaveBeenCalledWith({ id: 'entry-1' }, { included: false });
    expect(auditService.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'opportunity.declined' }));
  });

  // ---- US-28 scenario 3: accepting a now-expired opportunity is rejected defensively ----
  it('rejects accepting an opportunity past its expiry, as a defensive race check', async () => {
    const past = new Date(Date.now() - 60_000);
    opportunityRepo.findOne.mockResolvedValue({
      id: 'opp-1', creatorId: 'creator-1', status: OpportunityStatus.PENDING, expiresAt: past,
    });

    await expect(service.accept('opp-1', 'creator-1', actor)).rejects.toThrow(GoneException);
    expect(opportunityRepo.save).toHaveBeenCalled(); // flips to expired as a side effect
  });

  // ---- Failure: a creator cannot touch another creator's opportunity ----
  it('rejects accepting an opportunity that does not belong to the authenticated creator', async () => {
    opportunityRepo.findOne.mockResolvedValue(null);

    await expect(service.accept('opp-1', 'creator-2', actor)).rejects.toThrow(NotFoundException);
  });
});
