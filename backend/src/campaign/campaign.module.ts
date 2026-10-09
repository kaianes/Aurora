import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import {
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

@Module({
  imports: [
    TypeOrmModule.forFeature([
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
