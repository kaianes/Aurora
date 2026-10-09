import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ShortlistService } from './shortlist.service';
import {
  CampaignState,
  ShortlistStatus,
  ShortlistEntryOrigin,
  ShortlistEntryDecision,
  CreatorStatus,
  CreatorOnboardingStatus,
  WorkspaceType,
  Role,
} from '../database/entities';

const mockRepo = () => ({
  findOne: vi.fn(),
  find: vi.fn().mockResolvedValue([]),
  create: vi.fn((data: any) => ({ ...data })),
  save: vi.fn((entity: any) =>
    Array.isArray(entity)
      ? Promise.resolve(entity.map((e) => ({ id: e.id || 'id-' + Math.random(), ...e })))
      : Promise.resolve({ id: entity.id || 'id-1', ...entity }),
  ),
  delete: vi.fn().mockResolvedValue({ affected: 0 }),
  update: vi.fn().mockResolvedValue({ affected: 0 }),
});

describe('ShortlistService - US-11/US-13/US-40', () => {
  let service: ShortlistService;
  let campaignRepo: ReturnType<typeof mockRepo>;
  let shortlistRepo: ReturnType<typeof mockRepo>;
  let entryRepo: ReturnType<typeof mockRepo>;
  let poolMemberRepo: ReturnType<typeof mockRepo>;
  let creatorRepo: ReturnType<typeof mockRepo>;
  let requestRepo: ReturnType<typeof mockRepo>;
  let membershipRepo: ReturnType<typeof mockRepo>;
  let operatorAccessRepo: ReturnType<typeof mockRepo>;
  let accountRepo: ReturnType<typeof mockRepo>;
  let opportunityRepo: ReturnType<typeof mockRepo>;
  let matchingQueue: { add: ReturnType<typeof vi.fn> };
  let exclusionService: { resolveExcludedCreatorIds: ReturnType<typeof vi.fn> };
  let auditService: { log: ReturnType<typeof vi.fn> };

  const actor = { userId: 'user-1', ipAddress: '127.0.0.1', userAgent: 'vitest' };

  beforeEach(() => {
    campaignRepo = mockRepo();
    shortlistRepo = mockRepo();
    entryRepo = mockRepo();
    poolMemberRepo = mockRepo();
    creatorRepo = mockRepo();
    requestRepo = mockRepo();
    membershipRepo = mockRepo();
    operatorAccessRepo = mockRepo();
    accountRepo = mockRepo();
    opportunityRepo = mockRepo();
    matchingQueue = { add: vi.fn().mockResolvedValue(undefined) };
    exclusionService = { resolveExcludedCreatorIds: vi.fn().mockResolvedValue([]) };
    auditService = { log: vi.fn().mockResolvedValue(undefined) };

    service = new ShortlistService(
      campaignRepo as any,
      shortlistRepo as any,
      entryRepo as any,
      poolMemberRepo as any,
      creatorRepo as any,
      requestRepo as any,
      membershipRepo as any,
      operatorAccessRepo as any,
      accountRepo as any,
      opportunityRepo as any,
      matchingQueue as any,
      exclusionService as any,
      auditService as any,
    );
  });

  // ---- US-11 scenario 1: normal request ----
  it('requests a shortlist for a confirmed campaign and enqueues generation', async () => {
    campaignRepo.findOne.mockResolvedValue({ id: 'camp-1', accountId: 'account-1', state: CampaignState.CONFIRMED });
    shortlistRepo.findOne.mockResolvedValue(null);

    const result = await service.requestShortlist('camp-1', 'account-1', actor);

    expect(result.status).toBe(ShortlistStatus.PENDING);
    expect(matchingQueue.add).toHaveBeenCalledWith('generate-shortlist', expect.objectContaining({ campaignId: 'camp-1' }));
    expect(auditService.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'shortlist.requested' }));
  });

  // ---- Failure: campaign not confirmed yet ----
  it('rejects a shortlist request for a draft campaign', async () => {
    campaignRepo.findOne.mockResolvedValue({ id: 'camp-1', accountId: 'account-1', state: CampaignState.DRAFT });

    await expect(service.requestShortlist('camp-1', 'account-1', actor)).rejects.toThrow(BadRequestException);
  });

  // ---- Failure: shortlist already locked ----
  it('rejects a shortlist regeneration request once the shortlist is locked', async () => {
    campaignRepo.findOne.mockResolvedValue({ id: 'camp-1', accountId: 'account-1', state: CampaignState.ACTIVE });
    shortlistRepo.findOne.mockResolvedValue({ id: 'sl-1', campaignId: 'camp-1', locked: true, lockedReason: 'campaign_activated' });

    await expect(service.requestShortlist('camp-1', 'account-1', actor)).rejects.toThrow(ConflictException);
  });

  // ---- US-13 scenario 1: approve and reject individual entries ----
  it('approves an entry and keeps it included', async () => {
    campaignRepo.findOne.mockResolvedValue({ id: 'camp-1', accountId: 'account-1', guaranteedMinPoolSize: 1 });
    shortlistRepo.findOne.mockResolvedValue({ id: 'sl-1', campaignId: 'camp-1', locked: false, belowGuaranteedMinimum: false });
    entryRepo.findOne.mockResolvedValue({
      id: 'entry-1', campaignId: 'camp-1', decision: ShortlistEntryDecision.PENDING, included: true,
    });
    entryRepo.find.mockResolvedValue([
      { id: 'entry-1', included: true, decision: ShortlistEntryDecision.APPROVED },
    ]);

    const result = await service.decideEntry('camp-1', 'entry-1', 'account-1', { decision: 'approved' }, actor);

    expect(result.decision).toBe(ShortlistEntryDecision.APPROVED);
    expect(result.included).toBe(true);
  });

  // ---- US-13 scenario 2: rejections drop the pool below the guaranteed minimum ----
  it('flags the pool as below the guaranteed minimum after a rejection drops it short', async () => {
    campaignRepo.findOne.mockResolvedValue({ id: 'camp-1', accountId: 'account-1', guaranteedMinPoolSize: 2 });
    shortlistRepo.findOne.mockResolvedValue({ id: 'sl-1', campaignId: 'camp-1', locked: false, belowGuaranteedMinimum: false });
    entryRepo.findOne.mockResolvedValue({
      id: 'entry-1', campaignId: 'camp-1', decision: ShortlistEntryDecision.PENDING, included: true,
    });
    entryRepo.find.mockResolvedValue([
      { id: 'entry-1', included: false, decision: ShortlistEntryDecision.REJECTED },
      { id: 'entry-2', included: true, decision: ShortlistEntryDecision.PENDING },
    ]);

    const result = await service.decideEntry('camp-1', 'entry-1', 'account-1', { decision: 'rejected' }, actor);

    expect(result.decision).toBe(ShortlistEntryDecision.REJECTED);
    expect(result.included).toBe(false);
    expect(result.warning).toBe('pool_below_guaranteed_minimum');
  });

  // ---- US-13 scenario 3: decisions are blocked once the shortlist is locked ----
  it('blocks a decision once the shortlist is locked (campaign activated)', async () => {
    campaignRepo.findOne.mockResolvedValue({ id: 'camp-1', accountId: 'account-1' });
    shortlistRepo.findOne.mockResolvedValue({
      id: 'sl-1', campaignId: 'camp-1', locked: true, lockedReason: 'campaign_activated',
    });

    await expect(
      service.decideEntry('camp-1', 'entry-1', 'account-1', { decision: 'approved' }, actor),
    ).rejects.toThrow(BadRequestException);
  });

  // ---- US-40 scenario 1: agency override removes and adds creators ----
  it('saves an agency override, locks the shortlist, and hands off to campaign_pool_member', async () => {
    accountRepo.findOne.mockResolvedValue({ id: 'account-client-1', workspace: { type: WorkspaceType.AGENCY } });
    campaignRepo.findOne.mockResolvedValue({
      id: 'camp-1', accountId: 'account-client-1', guaranteedMinPoolSize: 1, lockedPrice: '1000.00',
    });
    shortlistRepo.findOne.mockResolvedValue({
      id: 'sl-1', campaignId: 'camp-1', status: ShortlistStatus.READY, locked: false, requestedAt: new Date(),
    });
    entryRepo.find
      .mockResolvedValueOnce([
        { id: 'entry-1', creatorId: 'creator-1', included: true, decision: ShortlistEntryDecision.PENDING, origin: ShortlistEntryOrigin.SYSTEM_RANKED },
      ]) // initial entries for the override computation
      .mockResolvedValueOnce([
        { id: 'entry-1', creatorId: 'creator-1', included: false, decision: ShortlistEntryDecision.PENDING, origin: ShortlistEntryOrigin.SYSTEM_RANKED },
        { id: 'entry-2', creatorId: 'creator-2', included: true, decision: ShortlistEntryDecision.APPROVED, origin: ShortlistEntryOrigin.AGENCY_ADDED },
      ]) // final entries for lockAndHandoff / audit
      .mockResolvedValueOnce([
        { id: 'entry-1', creatorId: 'creator-1', included: true, decision: ShortlistEntryDecision.APPROVED },
      ]); // included entries queried inside lockAndHandoff
    poolMemberRepo.find.mockResolvedValue([]);
    opportunityRepo.find.mockResolvedValue([]);
    creatorRepo.findOne.mockResolvedValue({
      id: 'creator-2', status: CreatorStatus.ACTIVE, onboardingStatus: CreatorOnboardingStatus.QUALIFIED,
    });

    const result = await service.overrideShortlist(
      'camp-1',
      'account-client-1',
      Role.AGENCY_ADMIN,
      'user-1',
      { remove_entry_ids: ['entry-1'], add_creators: [{ creator_id: 'creator-2' }] },
      actor,
    );

    expect(result.locked).toBe(true);
    expect(result.locked_reason).toBe('agency_override');
    expect(poolMemberRepo.save).toHaveBeenCalled();
    expect(auditService.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'shortlist.agency_overridden' }));
  });

  // ---- US-40 scenario 3: adding an ineligible creator is rejected ----
  it('rejects adding a creator who has not completed onboarding qualification', async () => {
    accountRepo.findOne.mockResolvedValue({ id: 'account-client-1', workspace: { type: WorkspaceType.AGENCY } });
    campaignRepo.findOne.mockResolvedValue({ id: 'camp-1', accountId: 'account-client-1', guaranteedMinPoolSize: 1, lockedPrice: '1000.00' });
    shortlistRepo.findOne.mockResolvedValue({ id: 'sl-1', campaignId: 'camp-1', status: ShortlistStatus.READY, locked: false });
    entryRepo.find.mockResolvedValue([]);
    creatorRepo.findOne.mockResolvedValue({
      id: 'creator-3', status: CreatorStatus.ACTIVE, onboardingStatus: CreatorOnboardingStatus.PENDING,
    });

    await expect(
      service.overrideShortlist(
        'camp-1',
        'account-client-1',
        Role.AGENCY_ADMIN,
        'user-1',
        { add_creators: [{ creator_id: 'creator-3' }] },
        actor,
      ),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  // ---- Failure: an agency_operator without granted client access is blocked (NFR-16) ----
  it('blocks an agency_operator override attempt without operator_client_access', async () => {
    accountRepo.findOne.mockResolvedValue({ id: 'account-client-1', workspace: { type: WorkspaceType.AGENCY } });
    membershipRepo.findOne.mockResolvedValue({ id: 'membership-1' });
    operatorAccessRepo.findOne.mockResolvedValue(null);

    await expect(
      service.overrideShortlist(
        'camp-1',
        'account-client-1',
        Role.AGENCY_OPERATOR,
        'user-1',
        {},
        actor,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  // ---- Failure: override attempted on a non-agency account ----
  it('rejects an override attempted outside an agency workspace context', async () => {
    accountRepo.findOne.mockResolvedValue({ id: 'account-1', workspace: { type: WorkspaceType.BRAND } });

    await expect(
      service.overrideShortlist('camp-1', 'account-1', Role.AGENCY_ADMIN, 'user-1', {}, actor),
    ).rejects.toThrow(ForbiddenException);
  });
});
