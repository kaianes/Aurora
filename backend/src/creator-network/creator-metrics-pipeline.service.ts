import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Repository } from 'typeorm';
import {
  Creator,
  CreatorOnboardingStatus,
  CreatorAuthenticityStatus,
  CreatorSocialAccount,
  SocialAccountStatus,
  User,
} from '../database/entities';
import { TokenCipherService } from './token-cipher.service';
import {
  CREATOR_AUDIENCE_INSIGHTS_ADAPTER,
  CreatorAudienceInsightsAdapter,
} from './adapters/creator-audience-insights.adapter';
import {
  AUTHENTICITY_SCORING_ADAPTER,
  AuthenticityScoringAdapter,
} from './adapters/authenticity-scoring.adapter';
import {
  QUALIFICATION_THRESHOLDS,
  QUALIFICATION_PENDING_EXPECTED_READY_MINUTES,
  QualificationCriterion,
  addMinutes,
} from './creator-network.config';

// US-24.2, US-24.3, US-24.4 / ADR-0051, ADR-0052, ADR-0053 (section 9 of
// the E8 architecture doc, compute-creator-metrics job). Called once per
// successful OAuth callback; a transient adapter failure is surfaced by
// throwing, so the caller's Bull retry/backoff configuration handles the
// "retries on backoff" requirement without a custom loop here.
@Injectable()
export class CreatorMetricsPipelineService {
  private readonly logger = new Logger(CreatorMetricsPipelineService.name);

  constructor(
    @InjectRepository(Creator)
    private creatorRepo: Repository<Creator>,
    @InjectRepository(CreatorSocialAccount)
    private socialAccountRepo: Repository<CreatorSocialAccount>,
    @InjectRepository(User)
    private userRepo: Repository<User>,
    private tokenCipherService: TokenCipherService,
    @Inject(CREATOR_AUDIENCE_INSIGHTS_ADAPTER)
    private audienceInsightsAdapter: CreatorAudienceInsightsAdapter,
    @Inject(AUTHENTICITY_SCORING_ADAPTER)
    private authenticityScoringAdapter: AuthenticityScoringAdapter,
    @InjectQueue('email') private emailQueue: Queue,
  ) {}

  async computeAndQualify(creatorId: string, socialAccountId: string): Promise<void> {
    const creator = await this.creatorRepo.findOne({ where: { id: creatorId } });
    const socialAccount = await this.socialAccountRepo.findOne({ where: { id: socialAccountId } });
    if (!creator || !socialAccount) {
      this.logger.warn(`compute-creator-metrics: creator or social account not found (${creatorId})`);
      return;
    }

    const accessToken = this.tokenCipherService.decrypt({
      ciphertext: socialAccount.accessTokenCiphertext,
      nonce: socialAccount.accessTokenNonce,
      keyVersion: socialAccount.tokenKeyVersion,
    });

    const insights = await this.audienceInsightsAdapter.getAudienceInsights({
      creatorId,
      socialAccountId,
      platform: socialAccount.platform,
      accessToken,
    });

    if (insights.outcome !== 'success') {
      // ADR-0053: a transient adapter failure (rate_limited, unreachable --
      // and, defensively, auth_revoked, which likewise leaves nothing for
      // the qualification rule to evaluate) leaves onboarding_status
      // pending with an expected-readiness timestamp, set once, not
      // recomputed on every retry.
      if (!creator.qualificationExpectedReadyAt) {
        creator.onboardingStatus = CreatorOnboardingStatus.PENDING;
        creator.qualificationExpectedReadyAt = addMinutes(
          new Date(),
          QUALIFICATION_PENDING_EXPECTED_READY_MINUTES,
        );
        await this.creatorRepo.save(creator);
      }
      throw new Error(`creator-audience-insights adapter returned ${insights.outcome}`);
    }

    const wasPending =
      creator.onboardingStatus === CreatorOnboardingStatus.PENDING &&
      creator.qualificationExpectedReadyAt !== null;

    const now = new Date();
    creator.audienceSize = insights.audienceSize;
    creator.demographicComposition = insights.demographicComposition;
    creator.engagementRate = insights.engagementRate;
    creator.contentNiche = insights.contentNiche;
    creator.metricsComputedAt = now;
    creator.metricsStale = false;

    const authenticityResult = await this.authenticityScoringAdapter.scoreAuthenticity({
      creatorId,
      socialAccountId,
      audienceSize: insights.audienceSize,
      engagementRate: insights.engagementRate,
    });

    if (authenticityResult.outcome === 'scored') {
      creator.authenticityScore = String(authenticityResult.score);
      creator.authenticityStatus = CreatorAuthenticityStatus.SCORED;
    } else {
      // US-24.3 scenario 3: never a fabricated score.
      creator.authenticityScore = null;
      creator.authenticityStatus = CreatorAuthenticityStatus.INSUFFICIENT_DATA;
    }
    creator.authenticityComputedAt = now;

    await this.evaluateQualification(creator, now, wasPending);

    await this.creatorRepo.save(creator);

    if (wasPending) {
      await this.notifyQualificationDecided(creator);
    }
  }

  // ADR-0053: all three thresholds must hold. Authenticity is never
  // referenced here, by design (ADR-0052).
  private async evaluateQualification(creator: Creator, now: Date, wasPending: boolean) {
    const hasConnectedAccount =
      (await this.socialAccountRepo.count({
        where: { creatorId: creator.id, status: SocialAccountStatus.CONNECTED },
      })) > 0;

    const missing: string[] = [];
    if (!hasConnectedAccount) missing.push(QualificationCriterion.AT_LEAST_ONE_LINKED_ACCOUNT);
    if (creator.audienceSize === null || creator.audienceSize < QUALIFICATION_THRESHOLDS.minAudienceSize) {
      missing.push(QualificationCriterion.MIN_AUDIENCE_SIZE);
    }
    if (
      creator.engagementRate === null ||
      Number(creator.engagementRate) < QUALIFICATION_THRESHOLDS.minEngagementRate
    ) {
      missing.push(QualificationCriterion.MIN_ENGAGEMENT_RATE);
    }

    creator.onboardingStatus =
      missing.length === 0 ? CreatorOnboardingStatus.QUALIFIED : CreatorOnboardingStatus.NOT_QUALIFIED;
    creator.qualificationMissingCriteria = missing.length > 0 ? missing : null;
    creator.qualificationDecidedAt = now;
    creator.qualificationExpectedReadyAt = null;
    if (wasPending) {
      creator.qualificationNotifiedAt = now;
    }
  }

  private async notifyQualificationDecided(creator: Creator) {
    if (!creator.userId) return;
    const user = await this.userRepo.findOne({ where: { id: creator.userId } });
    if (!user) return;

    await this.emailQueue.add('send-email', {
      template: 'qualification_decided',
      to: user.email,
      subject: 'Sua analise de qualificacao esta pronta',
      data: {
        name: user.name,
        onboarding_status: creator.onboardingStatus,
        qualification_missing_criteria: creator.qualificationMissingCriteria,
      },
    });
  }
}
