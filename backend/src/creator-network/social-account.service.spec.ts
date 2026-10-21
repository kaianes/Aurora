import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SocialAccountService } from './social-account.service';
import { SocialAccountStatus } from '../database/entities';

const mockRepo = () => ({
  findOne: vi.fn(),
  find: vi.fn().mockResolvedValue([]),
  create: vi.fn((data: any) => ({ id: 'sa-1', ...data })),
  save: vi.fn((entity: any) => Promise.resolve(entity)),
});

describe('SocialAccountService - US-24.1', () => {
  let service: SocialAccountService;
  let socialAccountRepo: ReturnType<typeof mockRepo>;
  let consentRepo: ReturnType<typeof mockRepo>;
  let socialAuthAdapter: { getAuthorizationUrl: ReturnType<typeof vi.fn>; exchangeCode: ReturnType<typeof vi.fn> };
  let oauthStateService: { create: ReturnType<typeof vi.fn>; consume: ReturnType<typeof vi.fn> };
  let tokenCipherService: { encrypt: ReturnType<typeof vi.fn>; decrypt: ReturnType<typeof vi.fn> };
  let auditService: { log: ReturnType<typeof vi.fn> };
  let creatorNetworkQueue: { add: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    socialAccountRepo = mockRepo();
    consentRepo = mockRepo();
    socialAuthAdapter = {
      getAuthorizationUrl: vi.fn().mockReturnValue('https://aurora.com.br/_simulated-oauth/instagram?state=st-1'),
      exchangeCode: vi.fn(),
    };
    oauthStateService = { create: vi.fn().mockReturnValue('st-1'), consume: vi.fn() };
    tokenCipherService = {
      encrypt: vi.fn().mockReturnValue({ ciphertext: 'enc', nonce: 'nonce', keyVersion: 1 }),
      decrypt: vi.fn(),
    };
    auditService = { log: vi.fn().mockResolvedValue(undefined) };
    creatorNetworkQueue = { add: vi.fn().mockResolvedValue(undefined) };
    const configService = { get: vi.fn().mockReturnValue('http://localhost:3000') };

    service = new SocialAccountService(
      socialAccountRepo as any,
      consentRepo as any,
      socialAuthAdapter as any,
      oauthStateService as any,
      tokenCipherService as any,
      auditService as any,
      configService as any,
      creatorNetworkQueue as any,
    );
  });

  describe('authorize', () => {
    it('generates a bound CSRF state and an authorize_url from the adapter', async () => {
      const result = await service.authorize('creator-1', 'instagram');
      expect(oauthStateService.create).toHaveBeenCalledWith('creator-1', 'instagram');
      expect(result.authorize_url).toContain('_simulated-oauth/instagram');
      expect(result.state).toBe('st-1');
    });

    it('rejects an invalid platform', async () => {
      await expect(service.authorize('creator-1', 'facebook')).rejects.toThrow(BadRequestException);
    });
  });

  describe('handleCallback', () => {
    // Scenario 1: successful linking.
    it('on granted: encrypts and stores tokens, records OAuth consent, enqueues compute-creator-metrics', async () => {
      oauthStateService.consume.mockReturnValue({ creatorId: 'creator-1', platform: 'instagram' });
      socialAccountRepo.findOne.mockResolvedValue(null);
      consentRepo.findOne.mockResolvedValue({ termsVersion: '2026-10-01' });
      socialAuthAdapter.exchangeCode.mockResolvedValue({
        outcome: 'granted',
        accessToken: 'raw-access',
        refreshToken: 'raw-refresh',
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 60),
        scope: ['public_profile'],
        platformUserId: 'ig-123',
        platformHandle: '@duda',
      });

      const redirect = await service.handleCallback('instagram', { code: 'some-code', state: 'st-1' });

      expect(redirect).toContain('result=granted');
      expect(socialAccountRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: SocialAccountStatus.CONNECTED, accessTokenCiphertext: 'enc' }),
      );
      expect(consentRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ consentType: 'oauth_authorization', scope: ['public_profile'] }),
      );
      expect(creatorNetworkQueue.add).toHaveBeenCalledWith(
        'compute-creator-metrics',
        expect.objectContaining({ creatorId: 'creator-1' }),
        expect.anything(),
      );
    });

    // Scenario 3: denial.
    it('on an OAuth error query param: redirects with result=denied, never calling exchangeCode', async () => {
      oauthStateService.consume.mockReturnValue({ creatorId: 'creator-1', platform: 'instagram' });

      const redirect = await service.handleCallback('instagram', { state: 'st-1', error: 'access_denied' });

      expect(redirect).toContain('platform=instagram');
      expect(redirect).toContain('result=denied');
      expect(socialAuthAdapter.exchangeCode).not.toHaveBeenCalled();
    });

    // Scenario 3: platform unavailable (no code, no error).
    it('when neither code nor error is present: redirects with result=unavailable', async () => {
      oauthStateService.consume.mockReturnValue({ creatorId: 'creator-1', platform: 'instagram' });

      const redirect = await service.handleCallback('instagram', { state: 'st-1' });

      expect(redirect).toContain('result=unavailable');
    });

    it('400s on an invalid, expired, or reused state', async () => {
      oauthStateService.consume.mockReturnValue(null);

      await expect(
        service.handleCallback('instagram', { code: 'x', state: 'bad-state' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('disconnect', () => {
    // Scenario 2 (manual half): disconnecting never loses other profile data.
    it('sets status=disconnected and disconnect_reason=manual, retaining the row', async () => {
      const account = { id: 'sa-1', status: SocialAccountStatus.CONNECTED };
      socialAccountRepo.findOne.mockResolvedValue(account);

      await service.disconnect('creator-1', 'instagram');

      expect(socialAccountRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: SocialAccountStatus.DISCONNECTED, disconnectReason: 'manual' }),
      );
    });

    it('404s when no connection exists for that platform', async () => {
      socialAccountRepo.findOne.mockResolvedValue(null);
      await expect(service.disconnect('creator-1', 'instagram')).rejects.toThrow(NotFoundException);
    });
  });
});
