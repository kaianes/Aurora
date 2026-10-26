import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { ContentSubmission, ContentReviewDecision } from '../database/entities';
import { AuditService } from '../audit/audit.service';
import { ESCALATE_OVERDUE_REVIEWS_CRON } from './content-workflow.config';

// US-32b / FR-41 / ADR-0030: the sweeper that makes "the system shall
// escalate the review" concrete. No specific escalation target is invented
// (PRD open question 2) -- the flag is read by both Duda's and Marina's
// views.
@Injectable()
export class ContentWorkflowScheduledTasksService {
  private readonly logger = new Logger(ContentWorkflowScheduledTasksService.name);

  constructor(
    @InjectRepository(ContentSubmission)
    private submissionRepo: Repository<ContentSubmission>,
    @InjectRepository(ContentReviewDecision)
    private decisionRepo: Repository<ContentReviewDecision>,
    private auditService: AuditService,
  ) {}

  @Cron(ESCALATE_OVERDUE_REVIEWS_CRON)
  async escalateOverdueDraftReviews() {
    const candidates = await this.submissionRepo.find({
      where: { reviewDeadlineAt: LessThan(new Date()), reviewEscalated: false },
    });
    if (candidates.length === 0) return;

    let escalated = 0;
    for (const submission of candidates) {
      const decision = await this.decisionRepo.findOne({ where: { contentSubmissionId: submission.id } });
      if (decision) continue; // already decided -- nothing to escalate.

      submission.reviewEscalated = true;
      submission.reviewEscalatedAt = new Date();
      await this.submissionRepo.save(submission);
      escalated += 1;

      await this.auditService.log({
        actorUserId: null,
        targetAccountId: null,
        action: 'content_submission.review_escalated',
        metadata: { content_submission_id: submission.id, campaign_id: submission.campaignId },
      });
    }

    if (escalated > 0) {
      this.logger.log(`Escalated ${escalated} overdue draft reviews`);
    }
  }
}
