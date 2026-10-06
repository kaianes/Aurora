import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  Campaign,
  CampaignPoolMember,
  Creator,
  CreatorExclusion,
  CampaignShortlist,
  CampaignShortlistEntry,
  CampaignOpportunity,
  AdditionalCandidatesRequest,
  Membership,
  OperatorClientAccess,
  Account,
} from '../database/entities';
import { MATCHING_ENGINE_ADAPTER } from '../campaign/matching-engine.adapter';
import { RealMatchingEngineAdapter } from './real-matching-engine.adapter';
import { ExclusionService } from './exclusion.service';
import { ExclusionController } from './exclusion.controller';
import { CreatorMetricsService } from './creator-metrics.service';
import { CreatorController } from './creator.controller';
import { ShortlistService } from './shortlist.service';
import { ShortlistController } from './shortlist.controller';
import { GenerateShortlistProcessor } from './generate-shortlist.processor';
import { OpportunityService } from './opportunity.service';
import { CreatorPortalController } from './creator-portal.controller';
import { MatchingScheduledTasksService } from './matching-scheduled-tasks.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Campaign,
      CampaignPoolMember,
      Creator,
      CreatorExclusion,
      CampaignShortlist,
      CampaignShortlistEntry,
      CampaignOpportunity,
      AdditionalCandidatesRequest,
      Membership,
      OperatorClientAccess,
      Account,
    ]),
    BullModule.registerQueue({ name: 'matching' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get('JWT_SECRET'),
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [ExclusionController, CreatorController, ShortlistController, CreatorPortalController],
  providers: [
    ExclusionService,
    CreatorMetricsService,
    ShortlistService,
    OpportunityService,
    GenerateShortlistProcessor,
    MatchingScheduledTasksService,
    RealMatchingEngineAdapter,
    {
      // Replaces E2's stub (ADR-0011): the campaign module binds this same
      // token to RealMatchingEngineAdapter (one-line DI change, NFR-29).
      provide: MATCHING_ENGINE_ADAPTER,
      useExisting: RealMatchingEngineAdapter,
    },
  ],
  exports: [RealMatchingEngineAdapter, MATCHING_ENGINE_ADAPTER, ShortlistService],
})
export class MatchingModule {}
