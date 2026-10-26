import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';

import { CommonModule } from './common/common.module';
import { TenantContextModule } from './common/tenant-context/tenant-context.module';
import { TenantContextInterceptor } from './common/interceptors/tenant-context.interceptor';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { PricingModule } from './pricing/pricing.module';
import { BrandProfileModule } from './brand-profile/brand-profile.module';
import { InvitationModule } from './invitation/invitation.module';
import { WorkspaceModule } from './workspace/workspace.module';
import { AgencyModule } from './agency/agency.module';
import { JobsModule } from './jobs/jobs.module';
import { CampaignModule } from './campaign/campaign.module';
import { MatchingModule } from './matching/matching.module';
import { BrandSafetyModule } from './brand-safety/brand-safety.module';
import { ContentWorkflowModule } from './content-workflow/content-workflow.module';
import { PaymentsModule } from './payments/payments.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { CreatorNetworkModule } from './creator-network/creator-network.module';

import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';

import {
  Workspace,
  Account,
  User,
  Membership,
  BrandProfile,
  Invitation,
  VerificationToken,
  AuditLog,
  OperatorClientAccess,
  Campaign,
  CampaignQuote,
  CampaignPoolMember,
  CampaignReallocationEvent,
  CampaignStateTransition,
  CampaignTemplate,
  ReallocationBounds,
  PoolShortfallResolution,
  Creator,
  CreatorExclusion,
  CampaignShortlist,
  CampaignShortlistEntry,
  CampaignOpportunity,
  AdditionalCandidatesRequest,
  SafetyRuleset,
  SafetyRule,
  ContentSubmission,
  SafetyCheck,
  SafetyRuleTrigger,
  SafetyReviewQueueItem,
  PublishedContentSnapshot,
  Briefing,
  BriefingDistributionRecipient,
  BriefingQaThread,
  BriefingQaMessage,
  ContentReviewDecision,
  PayoutObligation,
  PayoutExecutionAttempt,
  LedgerEntry,
  TaxDocument,
  Invoice,
  InvoiceLineItem,
  ContentSubmissionMetricSnapshot,
  PerformanceMetricIngestionAttempt,
  CampaignPerformanceAggregate,
  CampaignPerformanceReport,
  ClientPerformanceReport,
  AgencyBrandingProfile,
  ClientReportShareLink,
  CreatorPublicImport,
  CreatorInvitation,
  CreatorConsentRecord,
  CreatorSocialAccount,
  CreatorRatePreference,
  CreatorMediaKitExport,
  CreatorDataSubjectRequest,
} from './database/entities';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get('DB_HOST', 'localhost'),
        port: configService.get<number>('DB_PORT', 5432),
        username: configService.get('DB_USERNAME', 'aurora'),
        password: configService.get('DB_PASSWORD', 'aurora'),
        database: configService.get('DB_DATABASE', 'aurora'),
        entities: [
          Workspace,
          Account,
          User,
          Membership,
          BrandProfile,
          Invitation,
          VerificationToken,
          AuditLog,
          OperatorClientAccess,
          Campaign,
          CampaignQuote,
          CampaignPoolMember,
          CampaignReallocationEvent,
          CampaignStateTransition,
          CampaignTemplate,
          ReallocationBounds,
          PoolShortfallResolution,
          Creator,
          CreatorExclusion,
          CampaignShortlist,
          CampaignShortlistEntry,
          CampaignOpportunity,
          AdditionalCandidatesRequest,
          SafetyRuleset,
          SafetyRule,
          ContentSubmission,
          SafetyCheck,
          SafetyRuleTrigger,
          SafetyReviewQueueItem,
          PublishedContentSnapshot,
          Briefing,
          BriefingDistributionRecipient,
          BriefingQaThread,
          BriefingQaMessage,
          ContentReviewDecision,
          PayoutObligation,
          PayoutExecutionAttempt,
          LedgerEntry,
          TaxDocument,
          Invoice,
          InvoiceLineItem,
          ContentSubmissionMetricSnapshot,
          PerformanceMetricIngestionAttempt,
          CampaignPerformanceAggregate,
          CampaignPerformanceReport,
          ClientPerformanceReport,
          AgencyBrandingProfile,
          ClientReportShareLink,
          CreatorPublicImport,
          CreatorInvitation,
          CreatorConsentRecord,
          CreatorSocialAccount,
          CreatorRatePreference,
          CreatorMediaKitExport,
          CreatorDataSubjectRequest,
        ],
        synchronize: configService.get('DB_SYNCHRONIZE', 'false') === 'true',
        logging: configService.get('DB_LOGGING', 'false') === 'true',
        // Explicit pool size (ADR-0063), rather than the pg driver default of
        // 10. After TenantContextInterceptor engages, a connection is held for
        // an entire request's duration, not just a single query, so this now
        // matters. 25 is a pilot-scale default sized against NFR-07 (200
        // concurrent creator sessions, 20 concurrent brand sessions -- a
        // session count, not an in-flight-request count) and NFR-04 (p95
        // request durations of 500ms reads / 1500ms writes, which bound how
        // long any one request actually holds its connection), leaving
        // headroom under Postgres's own default max_connections (100), which
        // this pool shares with the Bull job workers (see ADR-0063's "Known
        // gap" section). Revisit against real pilot traffic once available.
        extra: { max: 25 },
      }),
      inject: [ConfigService],
    }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        redis: {
          host: configService.get('REDIS_HOST', 'localhost'),
          port: configService.get<number>('REDIS_PORT', 6379),
          password: configService.get('REDIS_PASSWORD') || undefined,
        },
      }),
      inject: [ConfigService],
    }),
    ScheduleModule.forRoot(),
    CommonModule,
    TenantContextModule,
    AuditModule,
    AuthModule,
    PricingModule,
    BrandProfileModule,
    InvitationModule,
    WorkspaceModule,
    AgencyModule,
    JobsModule,
    CampaignModule,
    MatchingModule,
    BrandSafetyModule,
    ContentWorkflowModule,
    PaymentsModule,
    AnalyticsModule,
    CreatorNetworkModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: TenantContextInterceptor,
    },
  ],
})
export class AppModule {}
