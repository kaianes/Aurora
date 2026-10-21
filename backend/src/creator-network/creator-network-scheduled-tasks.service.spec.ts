import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CreatorNetworkScheduledTasksService } from './creator-network-scheduled-tasks.service';
import { SocialAccountStatus } from '../database/entities';

const mockRepo = () => ({
  find: vi.fn().mockResolvedValue([]),
  findOne: vi.fn(),
  update: vi.fn().mockResolvedValue({ affected: 0 }),
  delete: vi.fn().mockResolvedValue({ affected: 0 }),
  save: vi.fn((entity: any) => Promise.resolve(entity)),
});

describe('CreatorNetworkScheduledTasksService - section 9 jobs', () => {
  let service: CreatorNetworkScheduledTasksService;
  let creatorRepo: ReturnType<typeof mockRepo>;
  let invitationRepo: ReturnType<typeof mockRepo>;
  let socialAccountRepo: ReturnType<typeof mockRepo>;
  let auditService: { log: ReturnType<typeof vi.fn> };
  let tokenCipherService: { encrypt: ReturnType<typeof vi.fn>; decrypt: ReturnType<typeof vi.fn> };
  let socialAuthAdapter: { refreshToken: ReturnType<typeof vi.fn> };
  let audienceInsightsAdapter: { getAudienceInsights: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    creatorRepo = mockRepo();
    invitationRepo = mockRepo();
    socialAccountRepo = mockRepo();
    auditService = { log: vi.fn().mockResolvedValue(undefined) };
    tokenCipherService = {
      encrypt: vi.fn().mockReturnValue({ ciphertext: 'c', nonce: 'n', keyVersion: 1 }),
      decrypt: vi.fn().mockReturnValue('plain-refresh-token'),
    };
    socialAuthAdapter = { refreshToken: vi.fn() };
    audienceInsightsAdapter = { getAudienceInsights: vi.fn() };

    service = new CreatorNetworkScheduledTasksService(
      creatorRepo as any,
      invitationRepo as any,
      socialAccountRepo as any,
      auditService as any,
      tokenCipherService as any,
      socialAuthAdapter as any,
      audienceInsightsAdapter as any,
    );
  });

  // US-23.1 scenario 3
  it('expireUnclaimedProfiles audits before deleting, and deletes any invitation rows along with the creator', async () => {
    creatorRepo.find.mockResolvedValue([{ id: 'creator-1' }]);

    await service.expireUnclaimedProfiles();

    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'creator.unclaimed_profile_expired' }),
    );
    expect(invitationRepo.delete).toHaveBeenCalledWith({ creatorId: 'creator-1' });
    expect(creatorRepo.delete).toHaveBeenCalledWith({ id: 'creator-1' });
  });

  it('expirePendingInvitations marks overdue pending invitations as expired', async () => {
    invitationRepo.update.mockResolvedValue({ affected: 2 });
    await service.expirePendingInvitations();
    expect(invitationRepo.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending' }),
      { status: 'expired' },
    );
  });

  // US-24.1 scenario 2 (the proactive-detection half)
  it('refreshSocialTokens disconnects an account whose refresh comes back revoked', async () => {
    socialAccountRepo.find.mockResolvedValue([
      {
        id: 'sa-1',
        creatorId: 'creator-1',
        platform: 'instagram',
        refreshTokenCiphertext: 'c',
        refreshTokenNonce: 'n',
        tokenKeyVersion: 1,
      },
    ]);
    socialAuthAdapter.refreshToken.mockResolvedValue({ outcome: 'revoked' });

    await service.refreshSocialTokens();

    expect(socialAccountRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: SocialAccountStatus.DISCONNECTED, disconnectReason: 'revoked_by_platform' }),
    );
  });

  it('refreshSocialTokens re-encrypts and stores a successfully refreshed token', async () => {
    socialAccountRepo.find.mockResolvedValue([
      {
        id: 'sa-1',
        creatorId: 'creator-1',
        platform: 'instagram',
        refreshTokenCiphertext: 'c',
        refreshTokenNonce: 'n',
        tokenKeyVersion: 1,
      },
    ]);
    socialAuthAdapter.refreshToken.mockResolvedValue({
      outcome: 'refreshed',
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 60),
    });

    await service.refreshSocialTokens();

    expect(socialAccountRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ accessTokenCiphertext: 'c', lastRefreshedAt: expect.any(Date) }),
    );
  });

  // US-24.2 scenario 3: never blanks existing metrics on failure.
  it('refreshCreatorAudienceMetrics flags staleness without blanking existing values on failure', async () => {
    socialAccountRepo.find.mockResolvedValue([
      { id: 'sa-1', creatorId: 'creator-1', platform: 'instagram', accessTokenCiphertext: 'c', accessTokenNonce: 'n', tokenKeyVersion: 1 },
    ]);
    const creator = { id: 'creator-1', audienceSize: 8000, metricsStale: false };
    creatorRepo.findOne.mockResolvedValue(creator);
    audienceInsightsAdapter.getAudienceInsights.mockResolvedValue({ outcome: 'unreachable' });

    await service.refreshCreatorAudienceMetrics();

    expect(creator.audienceSize).toBe(8000); // untouched
    expect(creator.metricsStale).toBe(true);
  });

  // US-24.2 scenario 2: the actual recomputation.
  it('refreshCreatorAudienceMetrics updates metrics and clears staleness on success', async () => {
    socialAccountRepo.find.mockResolvedValue([
      { id: 'sa-1', creatorId: 'creator-1', platform: 'instagram', accessTokenCiphertext: 'c', accessTokenNonce: 'n', tokenKeyVersion: 1 },
    ]);
    const creator = { id: 'creator-1', audienceSize: 8000, metricsStale: true };
    creatorRepo.findOne.mockResolvedValue(creator);
    audienceInsightsAdapter.getAudienceInsights.mockResolvedValue({
      outcome: 'success',
      audienceSize: 9200,
      demographicComposition: {},
      engagementRate: '2.1',
      contentNiche: 'moda',
    });

    await service.refreshCreatorAudienceMetrics();

    expect(creator.audienceSize).toBe(9200);
    expect(creator.metricsStale).toBe(false);
  });
});
