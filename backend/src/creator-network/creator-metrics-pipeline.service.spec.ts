import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CreatorMetricsPipelineService } from './creator-metrics-pipeline.service';
import { CreatorOnboardingStatus, CreatorAuthenticityStatus } from '../database/entities';

const mockRepo = () => ({
  findOne: vi.fn(),
  count: vi.fn().mockResolvedValue(1),
  save: vi.fn((entity: any) => Promise.resolve(entity)),
});

describe('CreatorMetricsPipelineService - US-24.2, US-24.3, US-24.4 / ADR-0053', () => {
  let service: CreatorMetricsPipelineService;
  let creatorRepo: ReturnType<typeof mockRepo>;
  let socialAccountRepo: ReturnType<typeof mockRepo>;
  let userRepo: ReturnType<typeof mockRepo>;
  let tokenCipherService: { decrypt: ReturnType<typeof vi.fn> };
  let audienceInsightsAdapter: { getAudienceInsights: ReturnType<typeof vi.fn> };
  let authenticityScoringAdapter: { scoreAuthenticity: ReturnType<typeof vi.fn> };
  let emailQueue: { add: ReturnType<typeof vi.fn> };

  const baseCreator = (): Record<string, any> => ({
    id: 'creator-1',
    userId: 'user-1',
    onboardingStatus: CreatorOnboardingStatus.PENDING,
    qualificationExpectedReadyAt: null,
    audienceSize: null,
    engagementRate: null,
  });

  beforeEach(() => {
    creatorRepo = mockRepo();
    socialAccountRepo = mockRepo();
    userRepo = mockRepo();
    tokenCipherService = { decrypt: vi.fn().mockReturnValue('decrypted-access-token') };
    audienceInsightsAdapter = { getAudienceInsights: vi.fn() };
    authenticityScoringAdapter = { scoreAuthenticity: vi.fn() };
    emailQueue = { add: vi.fn().mockResolvedValue(undefined) };

    service = new CreatorMetricsPipelineService(
      creatorRepo as any,
      socialAccountRepo as any,
      userRepo as any,
      tokenCipherService as any,
      audienceInsightsAdapter as any,
      authenticityScoringAdapter as any,
      emailQueue as any,
    );
  });

  function mockSocialAccount() {
    socialAccountRepo.findOne.mockResolvedValue({
      id: 'sa-1',
      creatorId: 'creator-1',
      platform: 'instagram',
      accessTokenCiphertext: 'c',
      accessTokenNonce: 'n',
      tokenKeyVersion: 1,
    });
  }

  // US-24.4 scenario 1: qualifies.
  it('qualifies a creator who meets all three thresholds', async () => {
    const creator = baseCreator();
    creatorRepo.findOne.mockResolvedValue(creator);
    mockSocialAccount();
    socialAccountRepo.count.mockResolvedValue(1);
    audienceInsightsAdapter.getAudienceInsights.mockResolvedValue({
      outcome: 'success',
      audienceSize: 5000,
      demographicComposition: { '18-24': 0.5, '25-34': 0.5 },
      engagementRate: '2.5',
      contentNiche: 'beleza',
    });
    authenticityScoringAdapter.scoreAuthenticity.mockResolvedValue({ outcome: 'scored', score: 82 });

    await service.computeAndQualify('creator-1', 'sa-1');

    expect(creator.onboardingStatus).toBe(CreatorOnboardingStatus.QUALIFIED);
    expect(creator.qualificationMissingCriteria).toBeNull();
    expect(creator.authenticityStatus).toBe(CreatorAuthenticityStatus.SCORED);
    expect(creator.authenticityScore).toBe('82');
    expect(creatorRepo.save).toHaveBeenCalledWith(creator);
  });

  // US-24.4 scenario 2: does not qualify, names the specific criteria.
  it('does not qualify a creator below the minimum audience size and engagement rate, naming both', async () => {
    const creator = baseCreator();
    creatorRepo.findOne.mockResolvedValue(creator);
    mockSocialAccount();
    socialAccountRepo.count.mockResolvedValue(1);
    audienceInsightsAdapter.getAudienceInsights.mockResolvedValue({
      outcome: 'success',
      audienceSize: 100,
      demographicComposition: {},
      engagementRate: '0.3',
      contentNiche: 'beleza',
    });
    authenticityScoringAdapter.scoreAuthenticity.mockResolvedValue({ outcome: 'scored', score: 60 });

    await service.computeAndQualify('creator-1', 'sa-1');

    expect(creator.onboardingStatus).toBe(CreatorOnboardingStatus.NOT_QUALIFIED);
    expect(creator.qualificationMissingCriteria).toEqual(['min_audience_size', 'min_engagement_rate']);
  });

  // US-24.4 scenario 3: pending fallback on a transient adapter failure.
  it('leaves onboarding pending with an expected-readiness timestamp when the audience adapter is rate-limited, then retries', async () => {
    const creator = baseCreator();
    creatorRepo.findOne.mockResolvedValue(creator);
    mockSocialAccount();
    audienceInsightsAdapter.getAudienceInsights.mockResolvedValue({ outcome: 'rate_limited' });

    await expect(service.computeAndQualify('creator-1', 'sa-1')).rejects.toThrow();

    expect(creator.onboardingStatus).toBe(CreatorOnboardingStatus.PENDING);
    expect(creator.qualificationExpectedReadyAt).not.toBeNull();
  });

  it('notifies once a previously-pending decision finally resolves', async () => {
    const creator: Record<string, any> = {
      ...baseCreator(),
      onboardingStatus: CreatorOnboardingStatus.PENDING,
      qualificationExpectedReadyAt: new Date(Date.now() + 1000 * 60 * 5),
    };
    creatorRepo.findOne.mockResolvedValue(creator);
    mockSocialAccount();
    socialAccountRepo.count.mockResolvedValue(1);
    userRepo.findOne.mockResolvedValue({ id: 'user-1', email: 'duda@example.com', name: 'Duda' });
    audienceInsightsAdapter.getAudienceInsights.mockResolvedValue({
      outcome: 'success',
      audienceSize: 5000,
      demographicComposition: {},
      engagementRate: '2.5',
      contentNiche: 'beleza',
    });
    authenticityScoringAdapter.scoreAuthenticity.mockResolvedValue({ outcome: 'scored', score: 82 });

    await service.computeAndQualify('creator-1', 'sa-1');

    expect(creator.qualificationNotifiedAt).not.toBeNull();
    expect(emailQueue.add).toHaveBeenCalledWith(
      'send-email',
      expect.objectContaining({ template: 'qualification_decided', to: 'duda@example.com' }),
    );
  });

  // US-24.3 scenario 3: never fabricates a score.
  it('records authenticity_status=insufficient_data without blocking qualification when the model cannot score confidently', async () => {
    const creator = baseCreator();
    creatorRepo.findOne.mockResolvedValue(creator);
    mockSocialAccount();
    socialAccountRepo.count.mockResolvedValue(1);
    audienceInsightsAdapter.getAudienceInsights.mockResolvedValue({
      outcome: 'success',
      audienceSize: 5000,
      demographicComposition: {},
      engagementRate: '2.5',
      contentNiche: 'beleza',
    });
    authenticityScoringAdapter.scoreAuthenticity.mockResolvedValue({ outcome: 'insufficient_data' });

    await service.computeAndQualify('creator-1', 'sa-1');

    expect(creator.authenticityStatus).toBe(CreatorAuthenticityStatus.INSUFFICIENT_DATA);
    expect(creator.authenticityScore).toBeNull();
    // Authenticity never gates qualification (ADR-0052/ADR-0053).
    expect(creator.onboardingStatus).toBe(CreatorOnboardingStatus.QUALIFIED);
  });
});
