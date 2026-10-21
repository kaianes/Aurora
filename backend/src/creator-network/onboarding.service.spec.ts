import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { OnboardingService } from './onboarding.service';
import { CreatorOnboardingStatus } from '../database/entities';

const mockRepo = () => ({
  findOne: vi.fn(),
  find: vi.fn().mockResolvedValue([]),
  save: vi.fn((entity: any) => Promise.resolve(entity)),
});

describe('OnboardingService - US-24.4 (GET /creator-portal/onboarding/status)', () => {
  let service: OnboardingService;
  let creatorRepo: ReturnType<typeof mockRepo>;
  let socialAccountRepo: ReturnType<typeof mockRepo>;

  beforeEach(() => {
    creatorRepo = mockRepo();
    socialAccountRepo = mockRepo();
    service = new OnboardingService(creatorRepo as any, socialAccountRepo as any);
  });

  it('scenario 1: reports qualified with her metrics and linked platforms', async () => {
    creatorRepo.findOne.mockResolvedValue({
      id: 'creator-1',
      status: 'active',
      onboardingStatus: CreatorOnboardingStatus.QUALIFIED,
      audienceSize: 8400,
      engagementRate: '2.3',
      authenticityScore: '81',
      authenticityStatus: 'scored',
      qualificationDecidedAt: new Date('2026-10-21T10:04:12Z'),
    });
    socialAccountRepo.find.mockResolvedValue([{ platform: 'instagram' }]);

    const result = await service.getStatus('creator-1');

    expect(result.onboarding_status).toBe('qualified');
    expect(result.linked_platforms).toEqual(['instagram']);
    expect(result.authenticity_score).toBe(81);
  });

  it('scenario 2: names the specific missing criteria when not qualified', async () => {
    creatorRepo.findOne.mockResolvedValue({
      id: 'creator-1',
      status: 'active',
      onboardingStatus: CreatorOnboardingStatus.NOT_QUALIFIED,
      qualificationMissingCriteria: ['min_engagement_rate'],
      qualificationDecidedAt: new Date(),
    });

    const result = await service.getStatus('creator-1');

    expect(result.onboarding_status).toBe('not_qualified');
    expect(result.qualification_missing_criteria).toEqual(['min_engagement_rate']);
  });

  it('scenario 3: reports pending with an expected timeframe and a message', async () => {
    creatorRepo.findOne.mockResolvedValue({
      id: 'creator-1',
      status: 'active',
      onboardingStatus: CreatorOnboardingStatus.PENDING,
      qualificationExpectedReadyAt: new Date('2026-10-21T10:09:00Z'),
    });

    const result = await service.getStatus('creator-1');

    expect(result.onboarding_status).toBe('pending');
    expect(result.qualification_expected_ready_at).toBeDefined();
    expect(result.message).toContain('Avisaremos por email');
  });

  it('404s when the creator does not exist', async () => {
    creatorRepo.findOne.mockResolvedValue(null);
    await expect(service.getStatus('ghost')).rejects.toThrow(NotFoundException);
  });

  it('updateProfile overwrites only the given fields', async () => {
    const creator = { id: 'creator-1', displayName: 'Old', contentNiche: 'old-niche' };
    creatorRepo.findOne.mockResolvedValue(creator);

    const result = await service.updateProfile('creator-1', { display_name: 'New Name' });

    expect(result.display_name).toBe('New Name');
    expect(result.content_niche).toBe('old-niche');
  });
});
