import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  SafetyRuleset,
  SafetyRule,
  ContentSubmission,
  SafetyCheck,
  SafetyRuleTrigger,
  SafetyReviewQueueItem,
  PublishedContentSnapshot,
  Campaign,
  CampaignOpportunity,
  Creator,
} from '../database/entities';
import { RulesetService } from './ruleset.service';
import { RulesetController } from './ruleset.controller';
import { CampaignSafetyRulesetController } from './campaign-safety-ruleset.controller';
import { ContentSubmissionService } from './content-submission.service';
import { SafetyCheckController } from './safety-check.controller';
import { BrandSafetyGateService } from './brand-safety-gate.service';
import { ReviewQueueService } from './review-queue.service';
import { ReviewQueueController } from './review-queue.controller';
import { MonitoringService } from './monitoring.service';
import { MonitoringController } from './monitoring.controller';
import { ExtractContentChannelsProcessor } from './extract-content-channels.processor';
import { RunSafetyCheckProcessor } from './run-safety-check.processor';
import { BrandSafetyScheduledTasksService } from './brand-safety-scheduled-tasks.service';
import {
  CONTENT_SAFETY_ADAPTER,
  RealContentSafetyAdapter,
} from './adapters/content-safety.adapter';
import {
  MEDIA_EXTRACTION_ADAPTER,
  StubMediaExtractionAdapter,
} from './adapters/media-extraction.adapter';
import {
  LIVE_CONTENT_FETCHER,
  HttpLiveContentFetcher,
} from './adapters/live-content-fetcher';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SafetyRuleset,
      SafetyRule,
      ContentSubmission,
      SafetyCheck,
      SafetyRuleTrigger,
      SafetyReviewQueueItem,
      PublishedContentSnapshot,
      Campaign,
      CampaignOpportunity,
      Creator,
    ]),
    BullModule.registerQueue({ name: 'brand-safety' }),
    // The one creator-facing endpoint in this epic issues/consumes a
    // creator JWT (E3's CreatorAuthGuard), reusing the same secret every
    // other module's JwtModule registration uses.
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get('JWT_SECRET'),
      }),
      inject: [ConfigService],
    }),
  ],
  // ContentSubmissionIntakeController (E4's POST /creator-portal/content-
  // submissions stub) is retired here, superseded by content-workflow's own
  // controller at the same route (ADR-0032, section 7.4 of the E5
  // architecture doc) -- exactly the retirement ADR-0020 forecast in advance.
  controllers: [
    RulesetController,
    CampaignSafetyRulesetController,
    SafetyCheckController,
    ReviewQueueController,
    MonitoringController,
  ],
  providers: [
    RulesetService,
    ContentSubmissionService,
    BrandSafetyGateService,
    ReviewQueueService,
    MonitoringService,
    ExtractContentChannelsProcessor,
    RunSafetyCheckProcessor,
    BrandSafetyScheduledTasksService,
    RealContentSafetyAdapter,
    StubMediaExtractionAdapter,
    HttpLiveContentFetcher,
    {
      // ADR-0021: the run-safety-check job injects the token, never the
      // concrete class, so the cascade's implementation is swappable
      // without touching campaign/payment code or a migration (NFR-29).
      provide: CONTENT_SAFETY_ADAPTER,
      useExisting: RealContentSafetyAdapter,
    },
    {
      provide: MEDIA_EXTRACTION_ADAPTER,
      useExisting: StubMediaExtractionAdapter,
    },
    {
      provide: LIVE_CONTENT_FETCHER,
      useExisting: HttpLiveContentFetcher,
    },
  ],
  // BrandSafetyGateService's two public methods (section 3.6) remain the
  // fixed gate interface. ContentSubmissionService is additionally exported
  // (ADR-0032) so content-workflow's draft-intake endpoint can create a
  // content_submission row in-process, through the one code path that
  // creates one and starts its safety check -- not via HTTP, and not by
  // duplicating that logic. Nothing else in this module is exported
  // (NFR-29): content-workflow still cannot reach safety_check, safety_rule,
  // or safety_review_queue_item directly.
  exports: [BrandSafetyGateService, ContentSubmissionService],
})
export class BrandSafetyModule {}
