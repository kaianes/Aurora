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
import {
  MATCHING_ENGINE_ADAPTER,
  StubMatchingEngineAdapter,
} from './matching-engine.adapter';

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
      // Swapping to E3's real matching engine is a one-line DI binding
      // change (section 3.3.1 of the E2 architecture doc).
      provide: MATCHING_ENGINE_ADAPTER,
      useClass: StubMatchingEngineAdapter,
    },
  ],
  exports: [CampaignService, TemplateService],
})
export class CampaignModule {}
