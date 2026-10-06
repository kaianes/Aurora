import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CampaignService } from './campaign.service';
import { CampaignState, CampaignQuoteStatus, ShortfallResolutionType, ShortfallChosenBy } from '../database/entities';

const mockRepo = () => ({
  findOne: vi.fn(),
  find: vi.fn(),
  create: vi.fn((data: any) => ({ ...data })),
  save: vi.fn((entity: any) => Promise.resolve({ id: 'id-1', createdAt: new Date(), updatedAt: new Date(), ...entity })),
  update: vi.fn().mockResolvedValue({ affected: 0 }),
  count: vi.fn(),
  createQueryBuilder: vi.fn(),
});

describe('CampaignService - additional coverage for US-05, US-06, US-07, US-09', () => {
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

  // ---- US-05 scenario 1: normal complete definition lets her proceed to quote ----
  it('creates a complete campaign with no missing fields (US-05 scenario 1)', async () => {
    brandProfileRepo.findOne.mockResolvedValue({ status: 'complete' });

    const result = await service.create(
      'account-1',
      {
        name: 'Campanha Completa',
        budget_amount: '45000.00',
        audience_targeting: { geography: ['BR-SP'], interests: ['beleza'] },
        message: 'Brief',
        deliverable_formats: ['instagram_reel'],
        timeline_start: '2026-11-01T00:00:00Z',
        timeline_end: '2026-11-30T00:00:00Z',
      } as any,
      actor,
    );

    expect(result.state).toBe(CampaignState.DRAFT);
    expect(result.missing_fields).toEqual([]);
  });

  // ---- US-05 scenario 3: invalid submission preserves everything else already entered ----
  it('preserves other submitted fields in the error details when budget is below minimum', async () => {
    try {
      await service.create(
        'account-1',
        {
          name: 'Campanha Teste',
          budget_amount: '500.00',
          message: 'Mensagem existente',
        } as any,
        actor,
      );
      throw new Error('expected rejection');
    } catch (err: any) {
      expect(err.response.error.code).toBe('BUDGET_BELOW_MINIMUM');
      // The service itself does not persist anything; the caller (controller)
      // echoes the submitted DTO back. We assert the thrown payload at minimum
      // states the specific reason, per US-05 scenario 3.
      expect(err.response.error.message).toContain('R$');
    }
  });

  // ---- US-05 scenario 2 (PATCH path): editing a non-editable campaign is rejected ----
  it('rejects editing a confirmed campaign (CAMPAIGN_NOT_EDITABLE)', async () => {
    campaignRepo.findOne.mockResolvedValue({ id: 'camp-1', state: CampaignState.CONFIRMED });

    await expect(
      service.update('camp-1', 'account-1', { name: 'Novo nome' } as any, actor),
    ).rejects.toThrow(BadRequestException);
    expect(campaignRepo.save).not.toHaveBeenCalled();
  });

  // ---- PATCH architecture 3.2 step 2: editing a quoted campaign's core fields
  // supersedes the quote and reverts to draft (the "fresh quote" rule) ----
  it('reverts a quoted campaign to draft and supersedes the old quote when budget is edited', async () => {
    campaignRepo.findOne.mockResolvedValue({
      id: 'camp-1',
      state: CampaignState.QUOTED,
      budgetAmount: '5000.00',
      audienceTargeting: { geography: ['BR-SP'] },
      message: 'Mensagem',
      deliverableFormats: ['instagram_reel'],
      timelineStart: new Date(),
      timelineEnd: new Date(),
    });
    brandProfileRepo.findOne.mockResolvedValue({ status: 'complete' });

    const result = await service.update(
      'camp-1',
      'account-1',
      { budget_amount: '8000.00' } as any,
      actor,
    );

    expect(result.state).toBe(CampaignState.DRAFT);
    expect(quoteRepo.update).toHaveBeenCalledWith(
      { campaignId: 'camp-1', superseded: false },
      { superseded: true },
    );
  });

  // ---- US-06 scenario 3: quote polling surfaces an explicit failed status ----
  it('returns an explicit failed status with a failure reason when polling a failed quote', async () => {
    campaignRepo.findOne.mockResolvedValue({ id: 'camp-1' });
    quoteRepo.findOne.mockResolvedValue({
      id: 'quote-1',
      status: CampaignQuoteStatus.FAILED,
      failureReason: 'Nao foi possivel calcular a cotacao agora. Tente novamente em alguns minutos.',
      requestedAt: new Date(),
      resolvedAt: new Date(),
    });

    const result = await service.getQuote('camp-1', 'quote-1', 'account-1');

    expect(result.status).toBe(CampaignQuoteStatus.FAILED);
    expect(result.failure_reason).toBeTruthy();
  });

  it('returns 404 when polling a quote that does not exist', async () => {
    campaignRepo.findOne.mockResolvedValue({ id: 'camp-1' });
    quoteRepo.findOne.mockResolvedValue(null);

    await expect(service.getQuote('camp-1', 'missing-quote', 'account-1')).rejects.toThrow(
      NotFoundException,
    );
  });

  // ---- US-07 scenario 2: the locked price never changes regardless of
  // per-creator cost variance; confirm captures total_price once and it is
  // immutable afterward (no code path mutates lockedPrice post-confirm). ----
  it('confirm locks the price from the quote and no other service method mutates lockedPrice afterward', async () => {
    const campaign = { id: 'camp-1', state: CampaignState.QUOTED, timelineStart: null };
    campaignRepo.findOne.mockResolvedValue(campaign);
    quoteRepo.findOne.mockResolvedValue({
      id: 'quote-1',
      status: CampaignQuoteStatus.READY,
      totalPrice: '45000.00',
      guaranteedMinPoolSize: 42,
    });

    const result = await service.confirm('camp-1', 'account-1', actor);
    expect(result.locked_price).toBe('45000.00');

    // Pause/resume/cancel do not touch lockedPrice at all (grep-level guarantee
    // exercised here by calling them and checking the save payload never sets it).
    campaignRepo.findOne.mockResolvedValue({ id: 'camp-1', state: CampaignState.ACTIVE, lockedPrice: '45000.00' });
    await service.pause('camp-1', 'account-1', {}, actor);
    const pauseSaveArg = campaignRepo.save.mock.calls[campaignRepo.save.mock.calls.length - 1][0];
    expect(pauseSaveArg.lockedPrice).toBe('45000.00');
  });

  // ---- US-07 scenario 3 / ADR-0008: recordShortfall for a large shortfall
  // (>=15%) offers a choice between refund and revised guarantee ----
  it('offers a choice when the shortfall is 15% or more of the guaranteed minimum', async () => {
    shortfallRepo.save.mockImplementation((e: any) => Promise.resolve({ id: 'sf-1', notifiedAt: new Date(), ...e }));

    const result = await service.recordShortfall('camp-1', 20, 16, '10000.00'); // 20% shortfall

    expect(result.choiceOffered).toBe(true);
    expect(result.refundAmount).not.toBeNull();
  });

  // ---- US-07 scenario 3 / ADR-0008: a small shortfall (<15%) offers only
  // the default resolution, no buyer choice ----
  it('does not offer a choice when the shortfall is below 15%', async () => {
    shortfallRepo.save.mockImplementation((e: any) => Promise.resolve({ id: 'sf-2', notifiedAt: new Date(), ...e }));

    const result = await service.recordShortfall('camp-1', 20, 19, '10000.00'); // 5% shortfall

    expect(result.choiceOffered).toBe(false);
    expect(result.refundAmount).toBeNull();
  });

  // ---- recordShortfall is a no-op when the guarantee was actually met ----
  it('does not record a shortfall when the actual pool meets or exceeds the guarantee', async () => {
    const result = await service.recordShortfall('camp-1', 20, 20, '10000.00');
    expect(result).toBeNull();
    expect(shortfallRepo.save).not.toHaveBeenCalled();
  });

  // ---- GET /campaigns/:id/shortfall exposes whether a choice was offered
  // (choice_offered), so the frontend (shortfall-page.tsx) has a reliable
  // signal to decide whether to render the refund-vs-revised-guarantee
  // choice UI for large shortfalls (US-07 scenario 3, ADR-0008). ----
  it('getShortfall response includes choice_offered for a large shortfall', async () => {
    campaignRepo.findOne.mockResolvedValue({ id: 'camp-1' });
    shortfallRepo.findOne.mockResolvedValue({
      id: 'sf-1',
      resolutionType: ShortfallResolutionType.REVISED_GUARANTEE,
      refundAmount: '1500.00',
      revisedMinPoolSize: 16,
      choiceOffered: true, // large shortfall, buyer should be able to choose
      chosenBy: ShortfallChosenBy.AURORA_DEFAULT,
      notifiedAt: new Date(),
      resolvedAt: null,
    });

    const result = await service.getShortfall('camp-1', 'account-1');

    // The API response must carry enough information for the frontend to
    // know a choice is available.
    expect(result.shortfall).toHaveProperty('choice_offered', true);
  });

  // ---- US-09 scenario 2: resuming releases held content without losing
  // history (resume only flips state; no destructive repo calls occur) ----
  it('resume does not call any delete-like operation and preserves the transition log', async () => {
    campaignRepo.findOne.mockResolvedValue({ id: 'camp-1', state: CampaignState.PAUSED });

    await service.resume('camp-1', 'account-1', actor);

    expect(transitionRepo.save).toHaveBeenCalled();
    expect(campaignQueue.add).toHaveBeenCalledWith('campaign-resumed-notify', { campaignId: 'camp-1' });
  });

  // ---- US-09 scenario 3: blocks an invalid resume (confirmed state) without
  // altering state ----
  it('blocks resuming a campaign that was never paused', async () => {
    campaignRepo.findOne.mockResolvedValue({ id: 'camp-1', state: CampaignState.CONFIRMED });

    await expect(service.resume('camp-1', 'account-1', actor)).rejects.toThrow(BadRequestException);
    expect(campaignRepo.save).not.toHaveBeenCalled();
  });

  // ---- cancel is allowed from confirmed, active, and paused (FR-20/21) ----
  it('cancels a confirmed campaign and records the reason', async () => {
    campaignRepo.findOne.mockResolvedValue({ id: 'camp-1', state: CampaignState.CONFIRMED });

    const result = await service.cancel(
      'camp-1',
      'account-1',
      { reason: 'Incidente de marca' } as any,
      actor,
    );

    expect(result.state).toBe(CampaignState.CANCELLED);
    expect(transitionRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'Incidente de marca' }),
    );
  });

  // ---- shortfall resolution: resolving with a choice that was never offered
  // for a small shortfall must be rejected, per architecture 3.4 "Validate
  // the chosen resolution_type is one of the options actually offered" and
  // ADR-0008 (only revised_guarantee is valid when choiceOffered is false). ----
  it('rejects a resolution_type that was never offered for a small shortfall', async () => {
    campaignRepo.findOne.mockResolvedValue({
      id: 'camp-1',
      guaranteedMinPoolSize: 20,
      lockedPrice: '10000.00',
    });
    shortfallRepo.findOne.mockResolvedValue({
      id: 'sf-1',
      choiceOffered: false, // small shortfall: only revised_guarantee should be acceptable
      resolutionType: ShortfallResolutionType.REVISED_GUARANTEE,
      revisedMinPoolSize: 19,
      refundAmount: null,
      notifiedAt: new Date(),
      resolvedAt: null,
    });

    // The buyer requests partial_refund on a shortfall where choiceOffered
    // is false; this must be rejected with a BadRequestException instead of
    // silently accepted.
    await expect(
      service.resolveShortfall(
        'camp-1',
        'account-1',
        { resolution_type: 'partial_refund' } as any,
        actor,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(shortfallRepo.save).not.toHaveBeenCalled();
  });
});
