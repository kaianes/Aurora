import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import {
  CreatorSocialAccount,
  SocialAccountStatus,
  SocialAccountDisconnectReason,
  SocialPlatform,
  CreatorConsentRecord,
  CreatorConsentType,
} from '../database/entities';
import { AuditService } from '../audit/audit.service';
import { OAuthStateService } from './oauth-state.service';
import { TokenCipherService } from './token-cipher.service';
import { SOCIAL_AUTH_ADAPTER, SocialAuthAdapter } from './adapters/social-auth.adapter';

const VALID_PLATFORMS = ['instagram', 'tiktok', 'youtube'];

// US-24.1 (sections 5.3-5.6 of the E8 architecture doc). OAuth linking,
// never a password, never a stored credential of any kind beyond the
// authorization token itself (NFR-15).
@Injectable()
export class SocialAccountService {
  constructor(
    @InjectRepository(CreatorSocialAccount)
    private socialAccountRepo: Repository<CreatorSocialAccount>,
    @InjectRepository(CreatorConsentRecord)
    private consentRepo: Repository<CreatorConsentRecord>,
    @Inject(SOCIAL_AUTH_ADAPTER)
    private socialAuthAdapter: SocialAuthAdapter,
    private oauthStateService: OAuthStateService,
    private tokenCipherService: TokenCipherService,
    private auditService: AuditService,
    private configService: ConfigService,
    @InjectQueue('creator-network') private creatorNetworkQueue: Queue,
  ) {}

  private assertValidPlatform(platform: string) {
    if (!VALID_PLATFORMS.includes(platform)) {
      throw new BadRequestException({
        error: { code: 'INVALID_PLATFORM', message: 'Plataforma invalida.', details: {} },
      });
    }
  }

  private callbackRedirectUri(platform: string): string {
    const backendUrl = this.configService.get('BACKEND_URL') || 'http://localhost:3001';
    return `${backendUrl}/v1/creator-portal/social-accounts/${platform}/callback`;
  }

  async authorize(creatorId: string, platform: string) {
    this.assertValidPlatform(platform);
    const state = this.oauthStateService.create(creatorId, platform);
    const authorizeUrl = this.socialAuthAdapter.getAuthorizationUrl({
      platform: platform as any,
      state,
      redirectUri: this.callbackRedirectUri(platform),
    });
    return { authorize_url: authorizeUrl, state };
  }

  // section 5.4. Resolves the three outcomes from the query parameters a
  // (simulated) platform redirect carries, returning the frontend URL the
  // controller should redirect the browser to in every case except an
  // invalid state, which has no creator identity to redirect safely with.
  async handleCallback(
    platform: string,
    query: { code?: string; state?: string; error?: string },
  ): Promise<string> {
    this.assertValidPlatform(platform);
    const frontendUrl = this.configService.get('FRONTEND_URL') || 'http://localhost:3000';

    if (!query.state) {
      throw new BadRequestException({
        error: { code: 'INVALID_OAUTH_STATE', message: 'Estado OAuth invalido.', details: {} },
      });
    }

    const resolved = this.oauthStateService.consume(query.state);
    if (!resolved || resolved.platform !== platform) {
      throw new BadRequestException({
        error: { code: 'INVALID_OAUTH_STATE', message: 'Estado OAuth invalido ou expirado.', details: {} },
      });
    }

    const { creatorId } = resolved;

    // US-24.1 scenario 3: denial and platform unavailability are never
    // treated as a registration failure, and never fall back to a stored
    // credential of any kind.
    if (query.error) {
      return `${frontendUrl}/creator-portal/onboarding/link-accounts?platform=${platform}&result=denied`;
    }
    if (!query.code) {
      return `${frontendUrl}/creator-portal/onboarding/link-accounts?platform=${platform}&result=unavailable`;
    }

    const result = await this.socialAuthAdapter.exchangeCode({
      platform,
      code: query.code,
      redirectUri: this.callbackRedirectUri(platform),
    });

    if (result.outcome === 'denied') {
      return `${frontendUrl}/creator-portal/onboarding/link-accounts?platform=${platform}&result=denied`;
    }
    if (result.outcome === 'unavailable') {
      return `${frontendUrl}/creator-portal/onboarding/link-accounts?platform=${platform}&result=unavailable`;
    }

    const now = new Date();
    const accessTokenEnc = this.tokenCipherService.encrypt(result.accessToken);
    const refreshTokenEnc = result.refreshToken
      ? this.tokenCipherService.encrypt(result.refreshToken)
      : null;

    let socialAccount = await this.socialAccountRepo.findOne({
      where: { creatorId, platform: platform as SocialPlatform },
    });

    if (!socialAccount) {
      socialAccount = this.socialAccountRepo.create({ creatorId, platform: platform as SocialPlatform });
    }

    socialAccount.platformUserId = result.platformUserId;
    socialAccount.platformHandle = result.platformHandle;
    socialAccount.status = SocialAccountStatus.CONNECTED;
    socialAccount.disconnectReason = null;
    socialAccount.accessTokenCiphertext = accessTokenEnc.ciphertext;
    socialAccount.accessTokenNonce = accessTokenEnc.nonce;
    socialAccount.refreshTokenCiphertext = refreshTokenEnc?.ciphertext ?? null;
    socialAccount.refreshTokenNonce = refreshTokenEnc?.nonce ?? null;
    socialAccount.tokenKeyVersion = accessTokenEnc.keyVersion;
    socialAccount.grantedScope = result.scope;
    socialAccount.tokenExpiresAt = result.expiresAt;
    socialAccount.connectedAt = now;
    socialAccount.disconnectedAt = null;
    await this.socialAccountRepo.save(socialAccount);

    await this.writeOAuthConsent(creatorId, result.scope);

    await this.auditService.log({
      actorUserId: null,
      targetAccountId: null,
      action: 'creator_social_account.connected',
      metadata: { creator_id: creatorId, platform, social_account_id: socialAccount.id },
    });

    // ADR-0053 / section 9 of the E8 architecture doc: retries on backoff
    // (1 minute, then exponential, capped at 6 attempts) when the audience-
    // insights adapter returns a transient failure -- the processor throws
    // in that case, and Bull's own retry mechanism re-runs the job.
    await this.creatorNetworkQueue.add(
      'compute-creator-metrics',
      { creatorId, socialAccountId: socialAccount.id },
      { attempts: 6, backoff: { type: 'exponential', delay: 60_000 } },
    );

    return `${frontendUrl}/creator-portal/onboarding/review?platform=${platform}&result=granted`;
  }

  async list(creatorId: string) {
    const accounts = await this.socialAccountRepo.find({ where: { creatorId } });
    return {
      data: accounts.map((a) => ({
        platform: a.platform,
        platform_handle: a.platformHandle,
        status: a.status,
        disconnect_reason: a.disconnectReason,
        connected_at: a.connectedAt?.toISOString() ?? null,
        disconnected_at: a.disconnectedAt?.toISOString() ?? null,
      })),
    };
  }

  async disconnect(creatorId: string, platform: string) {
    const account = await this.socialAccountRepo.findOne({
      where: { creatorId, platform: platform as SocialPlatform },
    });
    if (!account) {
      throw new NotFoundException({
        error: { code: 'SOCIAL_ACCOUNT_NOT_FOUND', message: 'Conexao nao encontrada.', details: {} },
      });
    }

    // Retained for audit, same discipline as E3's soft-removal of
    // shortlist entries; audience metrics already on the profile are left
    // untouched (section 5.6 of the E8 architecture doc).
    account.status = SocialAccountStatus.DISCONNECTED;
    account.disconnectReason = SocialAccountDisconnectReason.MANUAL;
    account.disconnectedAt = new Date();
    await this.socialAccountRepo.save(account);

    await this.auditService.log({
      actorUserId: null,
      targetAccountId: null,
      action: 'creator_social_account.disconnected',
      metadata: { creator_id: creatorId, platform, reason: 'manual' },
    });
  }

  private async writeOAuthConsent(creatorId: string, scope: string[]) {
    // NFR-22: every successful OAuth callback records a consent row with
    // the exact scopes granted. terms_version mirrors whatever version she
    // most recently accepted (registration or claim) -- there is no
    // separate "current terms version" concept for this event.
    const lastAcceptance = await this.consentRepo.findOne({
      where: { creatorId, consentType: CreatorConsentType.TERMS_ACCEPTANCE },
      order: { grantedAt: 'DESC' },
    });

    await this.consentRepo.save(
      this.consentRepo.create({
        creatorId,
        consentType: CreatorConsentType.OAUTH_AUTHORIZATION,
        scope,
        termsVersion: lastAcceptance?.termsVersion ?? null,
        grantedAt: new Date(),
      }),
    );
  }
}
