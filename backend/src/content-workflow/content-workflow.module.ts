import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import {
  Campaign,
  CampaignOpportunity,
  Creator,
  Briefing,
  BriefingDistributionRecipient,
  BriefingQaThread,
  BriefingQaMessage,
  ContentSubmission,
  ContentReviewDecision,
} from '../database/entities';
import { BrandSafetyModule } from '../brand-safety/brand-safety.module';
import { BriefingService } from './briefing.service';
import { BriefingController } from './briefing.controller';
import { BriefingQaService } from './briefing-qa.service';
import { BriefingQaController } from './briefing-qa.controller';
import { CreatorPortalBriefingController } from './creator-portal-briefing.controller';
import { DraftSubmissionService } from './draft-submission.service';
import { CampaignContentSubmissionController } from './campaign-content-submission.controller';
import { CreatorPortalContentSubmissionController } from './creator-portal-content-submission.controller';
import { ReviewDecisionService } from './review-decision.service';
import { ContentSubmissionDecisionController } from './content-submission-decision.controller';
import { PublicationService } from './publication.service';
import { DistributeBriefingProcessor } from './distribute-briefing.processor';
import { ContentWorkflowScheduledTasksService } from './content-workflow-scheduled-tasks.service';
import {
  BRIEFING_NOTIFICATION_ADAPTER,
  StubBriefingNotificationAdapter,
} from './adapters/briefing-notification.adapter';
import {
  PUBLICATION_LINK_VERIFIER_ADAPTER,
  StubPublicationLinkVerifierAdapter,
} from './adapters/publication-link-verifier.adapter';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Campaign,
      CampaignOpportunity,
      Creator,
      Briefing,
      BriefingDistributionRecipient,
      BriefingQaThread,
      BriefingQaMessage,
      ContentSubmission,
      ContentReviewDecision,
    ]),
    BullModule.registerQueue({ name: 'content-workflow' }),
    // ADR-0032: imports BrandSafetyModule to reach its two exported
    // services (ContentSubmissionService, BrandSafetyGateService) in
    // process -- content-workflow still cannot reach safety_check,
    // safety_rule, or safety_review_queue_item directly (NFR-29).
    BrandSafetyModule,
  ],
  controllers: [
    BriefingController,
    BriefingQaController,
    CreatorPortalBriefingController,
    CampaignContentSubmissionController,
    ContentSubmissionDecisionController,
    CreatorPortalContentSubmissionController,
  ],
  providers: [
    BriefingService,
    BriefingQaService,
    DraftSubmissionService,
    ReviewDecisionService,
    PublicationService,
    DistributeBriefingProcessor,
    ContentWorkflowScheduledTasksService,
    StubBriefingNotificationAdapter,
    StubPublicationLinkVerifierAdapter,
    {
      provide: BRIEFING_NOTIFICATION_ADAPTER,
      useExisting: StubBriefingNotificationAdapter,
    },
    {
      provide: PUBLICATION_LINK_VERIFIER_ADAPTER,
      useExisting: StubPublicationLinkVerifierAdapter,
    },
  ],
})
export class ContentWorkflowModule {}
