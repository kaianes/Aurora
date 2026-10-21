import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import {
  Creator,
  CreatorStatus,
  CreatorInvitation,
  CreatorInvitationStatus,
  CreatorSocialAccount,
  SocialAccountStatus,
  SocialAccountDisconnectReason,
} from '../database/entities';
import { AuditService } from '../audit/audit.service';
import { TokenCipherService } from './token-cipher.service';
import { SOCIAL_AUTH_ADAPTER, SocialAuthAdapter } from './adapters/social-auth.adapter';
import {
  CREATOR_AUDIENCE_INSIGHTS_ADAPTER,
  CreatorAudienceInsightsAdapter,
} from './adapters/creator-audience-insights.adapter';
import { TOKEN_REFRESH_LEAD_DAYS, addDays } from './creator-network.config';

// Section 9 of the E8 architecture doc.
@Injectable()
export class CreatorNetworkScheduledTasksService {
  private readonly logger = new Logger(CreatorNetworkScheduledTasksService.name);

  constructor(
    @InjectRepository(Creator)
    private creatorRepo: Repository<Creator>,
    @InjectRepository(CreatorInvitation)
    private invitationRepo: Repository<CreatorInvitation>,
    @InjectRepository(CreatorSocialAccount)
    private socialAccountRepo: Repository<CreatorSocialAccount>,
    private auditService: AuditService,
    private tokenCipherService: TokenCipherService,
    @Inject(SOCIAL_AUTH_ADAPTER)
    private socialAuthAdapter: SocialAuthAdapter,
    @Inject(CREATOR_AUDIENCE_INSIGHTS_ADAPTER)
    private audienceInsightsAdapter: CreatorAudienceInsightsAdapter,
  ) {}

  // NFR-20: no manual trigger required. Writes the audit log before
  // deleting -- the audit log, not the creator row, is the durable record.
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async expireUnclaimedProfiles() {
    const expired = await this.creatorRepo.find({
      where: { status: CreatorStatus.UNCLAIMED, unclaimedExpiresAt: LessThan(new Date()) },
    });
    if (expired.length === 0) return;

    for (const creator of expired) {
      await this.auditService.log({
        actorUserId: null,
        targetAccountId: null,
        action: 'creator.unclaimed_profile_expired',
        metadata: { creator_id: creator.id },
      });

      // ADR-0055: unlike a decline, every creator_invitation row tied to
      // this creator is deleted here, not merely nulled -- there is no
      // single "this one was answered" row worth preserving. creator_public
      // _import cascades automatically on the creator delete below.
      await this.invitationRepo.delete({ creatorId: creator.id });
      await this.creatorRepo.delete({ id: creator.id });
    }

    this.logger.log(`Expired ${expired.length} unclaimed creator profiles`);
  }

  @Cron(CronExpression.EVERY_HOUR)
  async expirePendingInvitations() {
    const result = await this.invitationRepo.update(
      { status: CreatorInvitationStatus.PENDING, expiresAt: LessThan(new Date()) },
      { status: CreatorInvitationStatus.EXPIRED },
    );
    if (result.affected && result.affected > 0) {
      this.logger.log(`Expired ${result.affected} creator invitations`);
    }
  }

  // ADR-0049 / NFR-15: proactively rotates every connected token well
  // within the platform's own expiry, far more frequently than the 90-day
  // ceiling requires.
  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async refreshSocialTokens() {
    const dueBy = addDays(new Date(), TOKEN_REFRESH_LEAD_DAYS);
    const due = await this.socialAccountRepo.find({
      where: { status: SocialAccountStatus.CONNECTED, tokenExpiresAt: LessThan(dueBy) },
    });

    for (const account of due) {
      if (!account.refreshTokenCiphertext || !account.refreshTokenNonce) continue;

      const refreshToken = this.tokenCipherService.decrypt({
        ciphertext: account.refreshTokenCiphertext,
        nonce: account.refreshTokenNonce,
        keyVersion: account.tokenKeyVersion,
      });

      const result = await this.socialAuthAdapter.refreshToken({
        platform: account.platform,
        refreshToken,
      });

      if (result.outcome === 'refreshed') {
        const accessTokenEnc = this.tokenCipherService.encrypt(result.accessToken);
        const refreshTokenEnc = this.tokenCipherService.encrypt(result.refreshToken);
        account.accessTokenCiphertext = accessTokenEnc.ciphertext;
        account.accessTokenNonce = accessTokenEnc.nonce;
        account.refreshTokenCiphertext = refreshTokenEnc.ciphertext;
        account.refreshTokenNonce = refreshTokenEnc.nonce;
        account.tokenKeyVersion = accessTokenEnc.keyVersion;
        account.tokenExpiresAt = result.expiresAt;
        account.lastRefreshedAt = new Date();
        await this.socialAccountRepo.save(account);
      } else if (result.outcome === 'revoked') {
        // US-24.1 scenario 2: detected proactively here, not only when a
        // brand-facing read happens to fail.
        account.status = SocialAccountStatus.DISCONNECTED;
        account.disconnectReason = SocialAccountDisconnectReason.REVOKED_BY_PLATFORM;
        account.disconnectedAt = new Date();
        await this.socialAccountRepo.save(account);
        await this.auditService.log({
          actorUserId: null,
          targetAccountId: null,
          action: 'creator_social_account.disconnected',
          metadata: { creator_id: account.creatorId, platform: account.platform, reason: 'revoked_by_platform' },
        });
      }
      // 'unavailable': left connected, retried on the next daily run.
    }
  }

  // US-24.2 scenario 2: the actual computation E3's staleness flag already
  // assumes exists. Never blanks existing values on failure (NFR-35) --
  // only metrics_stale changes on a failed pull; this job never touches
  // authenticity or qualification.
  @Cron(CronExpression.EVERY_12_HOURS)
  async refreshCreatorAudienceMetrics() {
    const connected = await this.socialAccountRepo.find({
      where: { status: SocialAccountStatus.CONNECTED },
    });

    for (const account of connected) {
      const creator = await this.creatorRepo.findOne({ where: { id: account.creatorId } });
      if (!creator) continue;

      const accessToken = this.tokenCipherService.decrypt({
        ciphertext: account.accessTokenCiphertext,
        nonce: account.accessTokenNonce,
        keyVersion: account.tokenKeyVersion,
      });

      const insights = await this.audienceInsightsAdapter.getAudienceInsights({
        creatorId: creator.id,
        socialAccountId: account.id,
        platform: account.platform,
        accessToken,
      });

      if (insights.outcome === 'success') {
        creator.audienceSize = insights.audienceSize;
        creator.demographicComposition = insights.demographicComposition;
        creator.engagementRate = insights.engagementRate;
        creator.contentNiche = insights.contentNiche;
        creator.metricsComputedAt = new Date();
        creator.metricsStale = false;
        await this.creatorRepo.save(creator);
      } else {
        creator.metricsStale = true;
        await this.creatorRepo.save(creator);
      }
    }
  }
}
