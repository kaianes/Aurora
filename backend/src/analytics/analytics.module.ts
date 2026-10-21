import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import {
  Account,
  Campaign,
  CampaignOpportunity,
  CampaignPerformanceAggregate,
  CampaignPerformanceReport,
  CampaignPoolMember,
  ClientPerformanceReport,
  ContentSubmission,
  ContentSubmissionMetricSnapshot,
  Creator,
  Invoice,
  Membership,
  OperatorClientAccess,
  PerformanceMetricIngestionAttempt,
} from '../database/entities';
import { AgencyModule } from '../agency/agency.module';
import {
  SOCIAL_METRICS_ADAPTER,
  StubSocialMetricsAdapter,
} from './adapters/social-metrics.adapter';
import { MetricsIngestionService } from './metrics-ingestion.service';
import { AnalyticsScheduledTasksService } from './analytics-scheduled-tasks.service';
import { DashboardService } from './dashboard.service';
import { CampaignDashboardController } from './campaign-dashboard.controller';
import { CampaignReportService } from './campaign-report.service';
import { CampaignReportController } from './campaign-report.controller';
import { GenerateCampaignReportProcessor } from './generate-campaign-report.processor';
import { CreatorPerformanceService } from './creator-performance.service';
import { CreatorPortalPerformanceController } from './creator-portal-performance.controller';
import { PerformanceScoringService } from './performance-scoring.service';
import { ClientReportService } from './client-report.service';
import { GenerateClientReportProcessor } from './generate-client-report.processor';
import { AgencyClientReportController } from './agency-client-report.controller';
import { ClientComparisonService } from './client-comparison.service';
import { AgencyReportCompareController } from './agency-report-compare.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Account,
      Campaign,
      CampaignOpportunity,
      CampaignPoolMember,
      ContentSubmission,
      ContentSubmissionMetricSnapshot,
      PerformanceMetricIngestionAttempt,
      CampaignPerformanceAggregate,
      CampaignPerformanceReport,
      ClientPerformanceReport,
      Creator,
      Invoice,
      Membership,
      OperatorClientAccess,
    ]),
    BullModule.registerQueue({ name: 'analytics' }),
    // ADR-0048: imports AgencyModule to reach its one exported read method,
    // AgencyBrandingService.getBrandingProfile, in process -- the per-
    // client report renderer calls it, never reaching into agency's table
    // directly.
    AgencyModule,
  ],
  controllers: [
    CampaignDashboardController,
    CampaignReportController,
    CreatorPortalPerformanceController,
    AgencyClientReportController,
    AgencyReportCompareController,
  ],
  providers: [
    MetricsIngestionService,
    AnalyticsScheduledTasksService,
    DashboardService,
    CampaignReportService,
    GenerateCampaignReportProcessor,
    CreatorPerformanceService,
    PerformanceScoringService,
    ClientReportService,
    GenerateClientReportProcessor,
    ClientComparisonService,
    StubSocialMetricsAdapter,
    {
      // ADR-0044: this pilot ships exactly this one implementation.
      // Swapping to a real per-platform adapter is a new class and a DI
      // binding change, nothing else (NFR-29).
      provide: SOCIAL_METRICS_ADAPTER,
      useExisting: StubSocialMetricsAdapter,
    },
  ],
  // PerformanceScoringService.getReallocationInputs is the only method
  // campaign's CampaignScheduledTasksService calls (ADR-0047); nothing else
  // in this module is exported.
  exports: [PerformanceScoringService],
})
export class AnalyticsModule {}
