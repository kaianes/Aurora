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
import { ContentSubmissionIntakeController } from './content-submission-intake.controller';
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
  controllers: [
    RulesetController,
    CampaignSafetyRulesetController,
    ContentSubmissionIntakeController,
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
  // BrandSafetyGateService's two public methods (section 3.6) are the only
  // surface a future E5 or payments module is permitted to depend on
  // (NFR-29) -- nothing else in this module is exported.
  exports: [BrandSafetyGateService],
})
export class BrandSafetyModule {}
