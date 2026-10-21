import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  User,
  Creator,
  CreatorPublicImport,
  CreatorInvitation,
  CreatorConsentRecord,
  CreatorSocialAccount,
  CreatorRatePreference,
  CreatorMediaKitExport,
  CreatorDataSubjectRequest,
} from '../database/entities';
import { AuthModule } from '../auth/auth.module';
import { PaymentsModule } from '../payments/payments.module';
import { AnalyticsModule } from '../analytics/analytics.module';

import { UnclaimedProfileService } from './unclaimed-profile.service';
import { InvitationService } from './invitation.service';
import { CreatorRegistrationService } from './creator-registration.service';
import { SocialAccountService } from './social-account.service';
import { OAuthStateService } from './oauth-state.service';
import { TokenCipherService } from './token-cipher.service';
import { CreatorMetricsPipelineService } from './creator-metrics-pipeline.service';
import { ComputeCreatorMetricsProcessor } from './compute-creator-metrics.processor';
import { OnboardingService } from './onboarding.service';
import { RatePreferenceService } from './rate-preference.service';
import { MediaKitService } from './media-kit.service';
import { GenerateMediaKitProcessor } from './generate-media-kit.processor';
import { DataSubjectRequestService } from './data-subject-request.service';
import { CreatorNetworkScheduledTasksService } from './creator-network-scheduled-tasks.service';

import { OpsCreatorController } from './ops-creator.controller';
import { CreatorRegistrationController } from './creator-registration.controller';
import { CreatorClaimController } from './creator-claim.controller';
import { SocialAccountController } from './social-account.controller';
import { OnboardingController } from './onboarding.controller';
import { RatePreferenceController } from './rate-preference.controller';
import { MediaKitController } from './media-kit.controller';

import { SOCIAL_AUTH_ADAPTER, StubSocialAuthAdapter } from './adapters/social-auth.adapter';
import {
  CREATOR_AUDIENCE_INSIGHTS_ADAPTER,
  StubCreatorAudienceInsightsAdapter,
} from './adapters/creator-audience-insights.adapter';
import {
  AUTHENTICITY_SCORING_ADAPTER,
  StubAuthenticityScoringAdapter,
} from './adapters/authenticity-scoring.adapter';

// E8 -- Creator Recruitment and Growth. A new module alongside auth,
// matching, brand-safety, content-workflow, payments, analytics, agency,
// audit, and jobs (section 1 of the E8 architecture doc). Imports
// PaymentsModule for OperatorAuthGuard (ADR-0038 precedent, one additive
// export) and AnalyticsModule for CreatorPerformanceService.
// getCreatorDeliveredPerformance (ADR-0057) -- the only two cross-module
// dependencies this epic introduces.
@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      Creator,
      CreatorPublicImport,
      CreatorInvitation,
      CreatorConsentRecord,
      CreatorSocialAccount,
      CreatorRatePreference,
      CreatorMediaKitExport,
      CreatorDataSubjectRequest,
    ]),
    BullModule.registerQueue({ name: 'creator-network' }),
    BullModule.registerQueue({ name: 'email' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get('JWT_SECRET'),
      }),
      inject: [ConfigService],
    }),
    AuthModule,
    PaymentsModule,
    AnalyticsModule,
  ],
  controllers: [
    OpsCreatorController,
    CreatorRegistrationController,
    CreatorClaimController,
    SocialAccountController,
    OnboardingController,
    RatePreferenceController,
    MediaKitController,
  ],
  providers: [
    UnclaimedProfileService,
    InvitationService,
    CreatorRegistrationService,
    SocialAccountService,
    OAuthStateService,
    TokenCipherService,
    CreatorMetricsPipelineService,
    ComputeCreatorMetricsProcessor,
    OnboardingService,
    RatePreferenceService,
    MediaKitService,
    GenerateMediaKitProcessor,
    DataSubjectRequestService,
    CreatorNetworkScheduledTasksService,
    StubSocialAuthAdapter,
    StubCreatorAudienceInsightsAdapter,
    StubAuthenticityScoringAdapter,
    {
      // ADR-0050: this pilot ships exactly this one implementation.
      // Swapping to a real per-platform OAuth client is a new class and a
      // DI binding change, nothing else (NFR-29).
      provide: SOCIAL_AUTH_ADAPTER,
      useExisting: StubSocialAuthAdapter,
    },
    {
      provide: CREATOR_AUDIENCE_INSIGHTS_ADAPTER,
      useExisting: StubCreatorAudienceInsightsAdapter,
    },
    {
      provide: AUTHENTICITY_SCORING_ADAPTER,
      useExisting: StubAuthenticityScoringAdapter,
    },
  ],
})
export class CreatorNetworkModule {}
