import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TemplateService } from './template.service';
import { CampaignState } from '../database/entities';

const mockRepo = () => ({
  findOne: vi.fn(),
  find: vi.fn(),
  create: vi.fn((data: any) => ({ ...data })),
  save: vi.fn((entity: any) => Promise.resolve({ id: 'id-1', createdAt: new Date(), updatedAt: new Date(), ...entity })),
});

describe('TemplateService - US-08', () => {
  let service: TemplateService;
  let campaignRepo: ReturnType<typeof mockRepo>;
  let templateRepo: ReturnType<typeof mockRepo>;
  let transitionRepo: ReturnType<typeof mockRepo>;
  let brandProfileRepo: ReturnType<typeof mockRepo>;
  let auditService: { log: ReturnType<typeof vi.fn> };

  const actor = { userId: 'user-1', ipAddress: '127.0.0.1', userAgent: 'vitest' };

  beforeEach(() => {
    campaignRepo = mockRepo();
    templateRepo = mockRepo();
    transitionRepo = mockRepo();
    brandProfileRepo = mockRepo();
    auditService = { log: vi.fn().mockResolvedValue(undefined) };

    service = new TemplateService(
      campaignRepo as any,
      templateRepo as any,
      transitionRepo as any,
      brandProfileRepo as any,
      auditService as any,
    );
  });

  // ---- US-08 scenario 1: template created from a confirmed campaign,
  // excludes budget and performance data ----
  it('saves a confirmed campaign as a template without budget, pool, or performance data', async () => {
    campaignRepo.findOne.mockResolvedValue({
      id: 'camp-1',
      state: CampaignState.CONFIRMED,
      budgetAmount: '45000.00',
      audienceTargeting: { geography: ['BR-SP'] },
      message: 'Brief',
      deliverableFormats: ['instagram_reel'],
      timelineStart: new Date('2026-11-01'),
      timelineEnd: new Date('2026-11-30'),
    });
    brandProfileRepo.findOne.mockResolvedValue({ prohibitedTopics: ['tabaco'], toneOfVoice: 'casual' });

    const result = await service.saveAsTemplate('camp-1', 'account-1', { name: 'Modelo padrao' } as any, actor);

    expect(result.name).toBe('Modelo padrao');
    expect(result).not.toHaveProperty('budget_amount');
    expect(result.timeline_shape).toEqual({ duration_days: 29 });
    const createCallArg = templateRepo.create.mock.calls[0][0];
    expect(createCallArg.audienceTargeting).toEqual({ geography: ['BR-SP'] });
    expect(createCallArg).not.toHaveProperty('budgetAmount');
  });

  // ---- Failure variant: cannot save a draft (never quoted/confirmed) campaign as a template ----
  it('rejects saving a draft campaign as a template', async () => {
    campaignRepo.findOne.mockResolvedValue({ id: 'camp-1', state: CampaignState.DRAFT });

    await expect(
      service.saveAsTemplate('camp-1', 'account-1', { name: 'Modelo' } as any, actor),
    ).rejects.toThrow(BadRequestException);
    expect(templateRepo.save).not.toHaveBeenCalled();
  });

  // ---- US-08 scenario 2: instantiating pre-fills every field from the
  // template except budget/timeline, which come fresh from the buyer, and the
  // new campaign requires a fresh quote (starts in draft, no quote attached) ----
  it('pre-fills template fields into a new draft campaign with the buyer-supplied budget and start date', async () => {
    templateRepo.findOne.mockResolvedValue({
      id: 'tmpl-1',
      audienceTargeting: { geography: ['BR-SP'] },
      message: 'Brief do modelo',
      deliverableFormats: ['instagram_reel'],
      timelineShape: { duration_days: 29 },
      brandProfileSnapshot: { prohibited_topics: [], tone_of_voice: 'casual' },
    });
    brandProfileRepo.findOne.mockResolvedValue({ prohibitedTopics: [], toneOfVoice: 'casual' });

    const result = await service.instantiate(
      'tmpl-1',
      'account-1',
      { name: 'Campanha Dezembro', budget_amount: '52000.00', timeline_start: '2026-12-05T00:00:00Z' } as any,
      actor,
    );

    expect(result.state).toBe(CampaignState.DRAFT);
    expect(result.budget_amount).toBe('52000.00');
    expect(result.message).toBe('Brief do modelo');
    expect(result.brand_profile_drift).toEqual([]);
    // timeline_end is derived from duration_days, not reused from any old quote.
    expect(new Date(result.timeline_end!).getTime()).toBeGreaterThan(
      new Date(result.timeline_start!).getTime(),
    );
  });

  // ---- US-08 scenario 3: brand profile drift is flagged, not silently applied ----
  it('flags brand_profile_drift when the current brand profile no longer matches the template snapshot', async () => {
    templateRepo.findOne.mockResolvedValue({
      id: 'tmpl-1',
      audienceTargeting: { geography: ['BR-SP'] },
      message: 'Brief',
      deliverableFormats: ['instagram_reel'],
      timelineShape: { duration_days: 29 },
      brandProfileSnapshot: { prohibited_topics: ['testes em animais'], tone_of_voice: 'formal' },
    });
    // Current brand profile dropped the prohibited topic and changed tone.
    brandProfileRepo.findOne.mockResolvedValue({ prohibitedTopics: [], toneOfVoice: 'casual' });

    const result = await service.instantiate(
      'tmpl-1',
      'account-1',
      { name: 'Campanha Nova', budget_amount: '30000.00', timeline_start: '2026-12-05T00:00:00Z' } as any,
      actor,
    );

    expect(result.brand_profile_drift).toContain('prohibited_topics');
    expect(result.brand_profile_drift).toContain('tone_of_voice');
    expect(result.state).toBe(CampaignState.DRAFT);
  });

  it('returns 404 when instantiating a template that does not exist for this account', async () => {
    templateRepo.findOne.mockResolvedValue(null);

    await expect(
      service.instantiate(
        'missing-tmpl',
        'account-1',
        { name: 'X', budget_amount: '5000.00', timeline_start: '2026-12-05T00:00:00Z' } as any,
        actor,
      ),
    ).rejects.toThrow(NotFoundException);
  });

  // ---- acknowledge-drift: unblocks quoting once every flagged field is confirmed ----
  it('clears brand_profile_drift once all flagged fields are acknowledged', async () => {
    campaignRepo.findOne.mockResolvedValue({
      id: 'camp-1',
      brandProfileDrift: ['prohibited_topics', 'tone_of_voice'],
    });

    const result = await service.acknowledgeDrift(
      'camp-1',
      'account-1',
      { acknowledged_fields: ['prohibited_topics', 'tone_of_voice'] } as any,
      actor,
    );

    expect(result.brand_profile_drift).toEqual([]);
  });

  // ---- Hard case: only partially acknowledging leaves the remaining field flagged ----
  it('leaves unacknowledged drift fields flagged when only some fields are confirmed', async () => {
    campaignRepo.findOne.mockResolvedValue({
      id: 'camp-1',
      brandProfileDrift: ['prohibited_topics', 'tone_of_voice'],
    });

    const result = await service.acknowledgeDrift(
      'camp-1',
      'account-1',
      { acknowledged_fields: ['prohibited_topics'] } as any,
      actor,
    );

    expect(result.brand_profile_drift).toEqual(['tone_of_voice']);
  });
});
