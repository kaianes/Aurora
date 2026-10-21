import { Process, Processor } from '@nestjs/bull';
import { Inject, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Job } from 'bull';
import { Repository } from 'typeorm';
import {
  ContentSubmission,
  Campaign,
  SafetyCheck,
  SafetyCheckStatus,
  SafetyCheckTier,
  SafetyRuleTrigger,
  SafetyTriggerChannel,
  SafetyReviewQueueItem,
  ReviewReasonCategory,
  ReviewItemStatus,
} from '../database/entities';
import { AuditService } from '../audit/audit.service';
import { RulesetService } from './ruleset.service';
import { CONTENT_SAFETY_ADAPTER, ContentSafetyAdapter } from './adapters/content-safety.adapter';

// Section 4 of the E4 architecture doc: calls ContentSafetyAdapter.evaluate
// (ADR-0021) with the effective ruleset and all available channels. The
// job's only responsibility is orchestration -- creating rows, persisting
// the verdict -- never judgment itself.
@Processor('brand-safety')
export class RunSafetyCheckProcessor {
  private readonly logger = new Logger(RunSafetyCheckProcessor.name);

  constructor(
    @InjectRepository(ContentSubmission)
    private submissionRepo: Repository<ContentSubmission>,
    @InjectRepository(Campaign)
    private campaignRepo: Repository<Campaign>,
    @InjectRepository(SafetyCheck)
    private checkRepo: Repository<SafetyCheck>,
    @InjectRepository(SafetyRuleTrigger)
    private triggerRepo: Repository<SafetyRuleTrigger>,
    @InjectRepository(SafetyReviewQueueItem)
    private reviewRepo: Repository<SafetyReviewQueueItem>,
    @Inject(CONTENT_SAFETY_ADAPTER)
    private contentSafetyAdapter: ContentSafetyAdapter,
    private rulesetService: RulesetService,
    private auditService: AuditService,
  ) {}

  @Process('run-safety-check')
  async handleRunSafetyCheck(job: Job<{ contentSubmissionId: string; safetyCheckId: string }>) {
    const { contentSubmissionId, safetyCheckId } = job.data;
    const check = await this.checkRepo.findOne({ where: { id: safetyCheckId } });
    const submission = await this.submissionRepo.findOne({ where: { id: contentSubmissionId } });

    if (!check || !submission) {
      this.logger.warn(`run-safety-check: missing data (${contentSubmissionId}/${safetyCheckId})`);
      return;
    }

    // Idempotent: a check already resolved (expire-pending-checks racing
    // this job, or a retry) is left untouched -- a resolved safety_check row
    // is terminal (section 2.7's state machine).
    if (check.status !== SafetyCheckStatus.PENDING) {
      return;
    }

    const campaign = await this.campaignRepo.findOne({ where: { id: submission.campaignId } });
    if (!campaign) {
      this.logger.warn(`run-safety-check: campaign not found for submission ${contentSubmissionId}`);
      return;
    }

    try {
      const effectiveRuleset = await this.rulesetService.computeEffectiveRulesForEvaluation(
        submission.campaignId,
        campaign.accountId,
      );

      const result = await this.contentSafetyAdapter.evaluate({
        campaignId: submission.campaignId,
        effectiveRuleset,
        channels: {
          caption: submission.captionText,
          onScreenText: submission.onScreenText,
          audioTranscript: submission.audioTranscript,
        },
      });

      const tierReached = result.tierReached === 'tier1' ? SafetyCheckTier.TIER1 : SafetyCheckTier.TIER2;

      if (result.outcome === 'pass') {
        check.status = SafetyCheckStatus.PASSED;
        check.tierReached = tierReached;
        check.resolvedAt = new Date();
        await this.checkRepo.save(check);

        await this.auditService.log({
          actorUserId: null,
          targetAccountId: campaign.accountId,
          action: 'safety_check.passed',
          metadata: {
            content_submission_id: contentSubmissionId,
            safety_check_id: check.id,
            tier_reached: result.tierReached,
          },
        });
        return;
      }

      // flagged: status is a single aggregate over all triggers for this
      // check -- a pass in some channels never produces an overall pass if
      // any other channel triggered (US-16 scenario 2).
      check.status = SafetyCheckStatus.FLAGGED;
      check.tierReached = tierReached;
      check.resolvedAt = new Date();
      await this.checkRepo.save(check);

      const triggerRows = result.triggers.map((t) =>
        this.triggerRepo.create({
          safetyCheckId: check.id,
          ruleId: t.ruleId,
          channel: t.channel as SafetyTriggerChannel,
          matchedExcerpt: t.matchedExcerpt,
          tier: tierReached,
        }),
      );
      await this.triggerRepo.save(triggerRows);

      await this.reviewRepo.save(
        this.reviewRepo.create({
          safetyCheckId: check.id,
          campaignId: submission.campaignId,
          contentSubmissionId,
          reasonCategory: ReviewReasonCategory.RULE_VIOLATION,
          status: ReviewItemStatus.PENDING,
        }),
      );

      await this.auditService.log({
        actorUserId: null,
        targetAccountId: campaign.accountId,
        action: 'safety_check.flagged',
        metadata: {
          content_submission_id: contentSubmissionId,
          safety_check_id: check.id,
          tier_reached: result.tierReached,
          rule_ids: result.triggers.map((t) => t.ruleId),
        },
      });
    } catch (error) {
      // An adapter failure is "the engine is down" (ADR-0022's own
      // motivating example): the check is left pending, and
      // expire-pending-checks is the single mechanism that will eventually
      // transition it to check_unavailable once timeout_at passes.
      this.logger.error(
        `run-safety-check failed for ${contentSubmissionId}: ${(error as Error).message}`,
      );
    }
  }
}
