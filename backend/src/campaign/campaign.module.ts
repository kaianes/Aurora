import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import {
  Account,
  Campaign,
  CampaignQuote,
  CampaignPoolMember,
  CampaignReallocationEvent,
  CampaignStateTransition,
  CampaignTemplate,
  ReallocationBounds,
  PoolShortfallResolution,
  BrandProfile,
} from '../database/entities';
import { CampaignController } from './campaign.controller';
import { CampaignService } from './campaign.service';
import { TemplateController } from './template.controller';
import { TemplateService } from './template.service';
import { QuoteProcessor } from './quote.processor';
import { ReallocationProcessor } from './reallocation.processor';
import { PoolFillCheckProcessor } from './pool-fill-check.processor';
import { CampaignScheduledTasksService } from './campaign-scheduled-tasks.service';
import { MATCHING_ENGINE_ADAPTER } from './matching-engine.adapter';
import { MatchingModule } from '../matching/matching.module';
import { RealMatchingEngineAdapter } from '../matching/real-matching-engine.adapter';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AgencyModule } from '../agency/agency.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Account,
      Campaign,
      CampaignQuote,
      CampaignPoolMember,
      CampaignReallocationEvent,
      CampaignStateTransition,
      CampaignTemplate,
      ReallocationBounds,
      PoolShortfallResolution,
      BrandProfile,
    ]),
    BullModule.registerQueue({ name: 'campaign' }),
    MatchingModule,
    // ADR-0047: imports AnalyticsModule to reach its one exported service,
    // PerformanceScoringService, in process -- CampaignScheduledTasksService
    // calls getReallocationInputs immediately before enqueueing each
    // reallocate-budget job, the same mechanism ADR-0032/ADR-0036 already
    // established for other cross-module hand-offs.
    AnalyticsModule,
    // US-41 / FR-22, section 4.2 of the E9 architecture doc: imports
    // AgencyModule to reach its exported TemplateCopyService in process, so
    // POST /campaign-templates/:id/copy reuses the same escape-hatch
    // mechanics the onboarding-time bulk copy already uses, rather than
    // duplicating them here. Not circular: AgencyModule never imports
    // CampaignModule.
    AgencyModule,
  ],
  controllers: [CampaignController, TemplateController],
  providers: [
    CampaignService,
    TemplateService,
    QuoteProcessor,
    ReallocationProcessor,
    PoolFillCheckProcessor,
    CampaignScheduledTasksService,
    {
      // Swapping to E3's real matching engine was a one-line DI binding
      // change (section 3.3.1 of the E2 architecture doc, ADR-0011):
      // RealMatchingEngineAdapter is provided by the matching module and
      // bound here under the same token campaign has always consumed.
      provide: MATCHING_ENGINE_ADAPTER,
      useExisting: RealMatchingEngineAdapter,
    },
  ],
  exports: [CampaignService, TemplateService],
})
export class CampaignModule {}
