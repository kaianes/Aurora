import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, UnprocessableEntityException, ConflictException } from '@nestjs/common';
import { CampaignService } from './campaign.service';
import { CampaignState, CampaignQuoteStatus } from '../database/entities';

const mockRepo = () => ({
  findOne: vi.fn(),
  find: vi.fn(),
  create: vi.fn((data: any) => ({ ...data })),
  save: vi.fn((entity: any) => Promise.resolve({ id: 'id-1', createdAt: new Date(), updatedAt: new Date(), ...entity })),
  update: vi.fn().mockResolvedValue({ affected: 0 }),
  count: vi.fn(),
  createQueryBuilder: vi.fn(),
});

describe('CampaignService - US-05/US-06/US-07/US-09', () => {
  let service: CampaignService;
  let campaignRepo: ReturnType<typeof mockRepo>;
  let quoteRepo: ReturnType<typeof mockRepo>;
  let transitionRepo: ReturnType<typeof mockRepo>;
  let boundsRepo: ReturnType<typeof mockRepo>;
  let shortfallRepo: ReturnType<typeof mockRepo>;
  let reallocationEventRepo: ReturnType<typeof mockRepo>;
  let brandProfileRepo: ReturnType<typeof mockRepo>;
  let auditService: { log: ReturnType<typeof vi.fn> };
  let campaignQueue: { add: ReturnType<typeof vi.fn> };

  const actor = { userId: 'user-1', ipAddress: '127.0.0.1', userAgent: 'vitest' };

  beforeEach(() => {
    campaignRepo = mockRepo();
    quoteRepo = mockRepo();
    transitionRepo = mockRepo();
    boundsRepo = mockRepo();
    shortfallRepo = mockRepo();
    reallocationEventRepo = mockRepo();
    brandProfileRepo = mockRepo();
    auditService = { log: vi.fn().mockResolvedValue(undefined) };
    campaignQueue = { add: vi.fn().mockResolvedValue(undefined) };

    service = new CampaignService(
      campaignRepo as any,
      quoteRepo as any,
      transitionRepo as any,
      boundsRepo as any,
      shortfallRepo as any,
      reallocationEventRepo as any,
      brandProfileRepo as any,
      campaignQueue as any,
      auditService as any,
    );
  });

  // US-05 scenario 3: invalid budget is rejected before persisting anything.
  it('rejects a campaign with a budget below the platform minimum', async () => {
    await expect(
      service.create(
        'account-1',
        { name: 'Campanha Teste', budget_amount: '500.00' } as any,
        actor,
      ),
    ).rejects.toThrow(UnprocessableEntityException);

    expect(campaignRepo.save).not.toHaveBeenCalled();
  });

  // US-05 scenario 2: partial campaign is saved as draft with missing_fields populated.
  it('saves a partial campaign as draft and lists missing fields', async () => {
    brandProfileRepo.findOne.mockResolvedValue({ status: 'complete' });

    const result = await service.create(
      'account-1',
      { name: 'Campanha Parcial', budget_amount: '5000.00' } as any,
      actor,
    );

    expect(result.state).toBe(CampaignState.DRAFT);
    expect(result.missing_fields).toContain('message');
    expect(result.missing_fields).toContain('deliverable_formats');
  });

  // US-05 scenario 3: narrow targeting with zero addressable creators is rejected.
  it('rejects targeting with no addressable creators', async () => {
    await expect(
      service.create(
        'account-1',
        {
          name: 'Campanha Nicho',
          audience_targeting: { geography: [], interests: [], age_range: [20, 20] },
        } as any,
        actor,
      ),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  // US-06 scenario 1: requesting a quote enqueues the compute-quote job and returns pending.
  it('enqueues a compute-quote job when a complete draft requests a quote', async () => {
    const campaign = {
      id: 'camp-1',
      state: CampaignState.DRAFT,
      budgetAmount: '5000.00',
      audienceTargeting: { geography: ['BR-SP'] },
      message: 'Mensagem',
      deliverableFormats: ['instagram_reel'],
      timelineStart: new Date(),
      timelineEnd: new Date(),
      brandProfileDrift: null,
    };
    campaignRepo.findOne.mockResolvedValue(campaign);
    quoteRepo.findOne.mockResolvedValue(null);
    quoteRepo.save.mockResolvedValue({ id: 'quote-1', status: CampaignQuoteStatus.PENDING });

    const result = await service.requestQuote('camp-1', 'account-1', actor);

    expect(campaignQueue.add).toHaveBeenCalledWith('compute-quote', {
      campaignId: 'camp-1',
      quoteId: 'quote-1',
    });
    expect(result.status).toBe(CampaignQuoteStatus.PENDING);
  });

  // US-05 scenario 2: no quote is generated from an incomplete definition.
  it('blocks a quote request when required fields are missing', async () => {
    campaignRepo.findOne.mockResolvedValue({
      id: 'camp-1',
      state: CampaignState.DRAFT,
      budgetAmount: null,
      audienceTargeting: null,
      message: null,
      deliverableFormats: null,
      timelineStart: null,
      timelineEnd: null,
      brandProfileDrift: null,
    });

    await expect(service.requestQuote('camp-1', 'account-1', actor)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects a second quote request while one is already pending', async () => {
    campaignRepo.findOne.mockResolvedValue({
      id: 'camp-1',
      state: CampaignState.DRAFT,
      budgetAmount: '5000.00',
      audienceTargeting: { geography: ['BR-SP'] },
      message: 'Mensagem',
      deliverableFormats: ['instagram_reel'],
      timelineStart: new Date(),
      timelineEnd: new Date(),
      brandProfileDrift: null,
    });
    quoteRepo.findOne.mockResolvedValue({ id: 'existing-quote', status: CampaignQuoteStatus.PENDING });

    await expect(service.requestQuote('camp-1', 'account-1', actor)).rejects.toThrow(
      ConflictException,
    );
  });

  // US-07 scenario 1: confirming locks the price and moves to confirmed.
  it('confirms a quoted campaign and locks the price', async () => {
    const campaign = { id: 'camp-1', state: CampaignState.QUOTED, timelineStart: null };
    campaignRepo.findOne.mockResolvedValue(campaign);
    quoteRepo.findOne.mockResolvedValue({
      id: 'quote-1',
      status: CampaignQuoteStatus.READY,
      totalPrice: '5000.00',
      guaranteedMinPoolSize: 10,
    });

    const result = await service.confirm('camp-1', 'account-1', actor);

    expect(result.state).toBe(CampaignState.CONFIRMED);
    expect(result.locked_price).toBe('5000.00');
    expect(boundsRepo.save).toHaveBeenCalled();
  });

  it('rejects confirmation when the quote is not ready', async () => {
    campaignRepo.findOne.mockResolvedValue({ id: 'camp-1', state: CampaignState.QUOTED });
    quoteRepo.findOne.mockResolvedValue(null);

    await expect(service.confirm('camp-1', 'account-1', actor)).rejects.toThrow(
      BadRequestException,
    );
  });

  // US-09 scenario 1: pause moves active -> paused.
  it('pauses an active campaign', async () => {
    campaignRepo.findOne.mockResolvedValue({ id: 'camp-1', state: CampaignState.ACTIVE });

    const result = await service.pause('camp-1', 'account-1', {}, actor);

    expect(result.state).toBe(CampaignState.PAUSED);
    expect(campaignQueue.add).toHaveBeenCalledWith('campaign-paused-notify', { campaignId: 'camp-1' });
  });

  // US-09 scenario 3: invalid transitions are blocked without altering state.
  it('blocks pausing a completed campaign', async () => {
    campaignRepo.findOne.mockResolvedValue({ id: 'camp-1', state: CampaignState.COMPLETED });

    await expect(service.pause('camp-1', 'account-1', {}, actor)).rejects.toThrow(
      BadRequestException,
    );
    expect(campaignRepo.save).not.toHaveBeenCalled();
  });

  it('blocks cancelling an already cancelled campaign', async () => {
    campaignRepo.findOne.mockResolvedValue({ id: 'camp-1', state: CampaignState.CANCELLED });

    await expect(service.cancel('camp-1', 'account-1', {}, actor)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('resumes a paused campaign back to active', async () => {
    campaignRepo.findOne.mockResolvedValue({ id: 'camp-1', state: CampaignState.PAUSED });

    const result = await service.resume('camp-1', 'account-1', actor);

    expect(result.state).toBe(CampaignState.ACTIVE);
  });

  // ADR-0007: reallocation bounds are persisted with the buyer's chosen values.
  it('saves reallocation bounds within the allowed range', async () => {
    campaignRepo.findOne.mockResolvedValue({ id: 'camp-1' });
    boundsRepo.findOne.mockResolvedValue(null);

    const result = await service.setReallocationBounds(
      'camp-1',
      'account-1',
      { enabled: true, max_shift_pct: 15, min_guaranteed_share_pct: 60 } as any,
      actor,
    );

    expect(result.enabled).toBe(true);
    expect(result.max_shift_pct).toBe(15);
    expect(result.min_guaranteed_share_pct).toBe(60);
  });
});
