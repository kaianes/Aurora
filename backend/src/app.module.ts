import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD } from '@nestjs/core';

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
        ],
        synchronize: configService.get('DB_SYNCHRONIZE', 'false') === 'true',
        logging: configService.get('DB_LOGGING', 'false') === 'true',
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
  ],
})
export class AppModule {}
