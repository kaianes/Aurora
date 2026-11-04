import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, LessThan } from 'typeorm';
import {
  SafetyCheck,
  SafetyCheckStatus,
  SafetyCheckTier,
  SafetyRuleTrigger,
  SafetyTriggerChannel,
  SafetyReviewQueueItem,
  ReviewReasonCategory,
  ReviewItemStatus,
  PublishedContentSnapshot,
  MonitoringStatus,
  MonitoringResult,
} from '../database/entities';
import { AuditService } from '../audit/audit.service';
import { LIVE_CONTENT_FETCHER, LiveContentFetcher } from './adapters/live-content-fetcher';
import { EXPIRE_PENDING_CHECKS_CRON, MONITORING_CRON } from './brand-safety.config';

@Injectable()
export class BrandSafetyScheduledTasksService {
  private readonly logger = new Logger(BrandSafetyScheduledTasksService.name);

  constructor(
    @Inject(LIVE_CONTENT_FETCHER)
    private liveContentFetcher: LiveContentFetcher,
    private auditService: AuditService,
    @InjectDataSource()
    private dataSource: DataSource,
  ) {}

  // ADR-0022: the single mechanism that transitions a stuck pending check to
  // check_unavailable, bounded by the hard timeout. Blocks publication
  // identically to a flag and routes to the same human review queue.
  //
  // Runs with no HTTP request, no user, and no single account to pin --
  // it scans every account's stale checks, not one tenant's. Under real RLS
  // enforcement (not merely specified-but-bypassed, 2026-11-02) that no-
  // account-context default used to mean "see nothing," which was merely
  // wrong; here it means current_setting(...)::uuid casts NULL inside the
  // campaign subquery the policy depends on, which the planner evaluates
  // even over zero matching rows -- wrong *and* a hard failure. Wrapped in
  // its own transaction (also fixing a real pre-existing gap: the per-check
  // writes below were never atomic before this) so SET LOCAL
  // app.aurora_system_job stays scoped to exactly this tick and can't leak
  // onto whatever request reuses this pooled connection next.
  @Cron(EXPIRE_PENDING_CHECKS_CRON)
  async expirePendingChecks() {
    await this.dataSource.transaction(async (manager) => {
      await manager.query(`SET LOCAL app.aurora_system_job = 'true'`);

      const checkRepo = manager.getRepository(SafetyCheck);
      const triggerRepo = manager.getRepository(SafetyRuleTrigger);
      const reviewRepo = manager.getRepository(SafetyReviewQueueItem);

      const stale = await checkRepo.find({
        where: { status: SafetyCheckStatus.PENDING, timeoutAt: LessThan(new Date()) },
      });
      if (stale.length === 0) return;

      for (const check of stale) {
        check.status = SafetyCheckStatus.CHECK_UNAVAILABLE;
        check.resolvedAt = new Date();
        await checkRepo.save(check);

        // Exactly one channel = 'system', rule_id = null row, so the review
        // queue has something honest to display without a fake rule citation.
        await triggerRepo.save(
          triggerRepo.create({
            safetyCheckId: check.id,
            ruleId: null,
            channel: SafetyTriggerChannel.SYSTEM,
            matchedExcerpt: null,
            tier: check.tierReached || SafetyCheckTier.TIER1,
          }),
        );

        await reviewRepo.save(
          reviewRepo.create({
            safetyCheckId: check.id,
            campaignId: check.campaignId,
            contentSubmissionId: check.contentSubmissionId,
            reasonCategory: ReviewReasonCategory.CHECK_UNAVAILABLE,
            status: ReviewItemStatus.PENDING,
          }),
        );

        await this.auditService.log({
          actorUserId: null,
          targetAccountId: null,
          action: 'safety_check.check_unavailable',
          metadata: { safety_check_id: check.id, content_submission_id: check.contentSubmissionId },
        });
      }
      this.logger.log(`Expired ${stale.length} pending safety checks to check_unavailable`);
    });
  }

  // ADR-0024: one cheap fetch-and-compare per published post per cycle,
  // never a full cascade re-run. Overwrites the previous result in place --
  // no history table (section 2.2 of the E4 architecture doc).
  //
  // Same cross-account, no-request scheduled-job shape as
  // expirePendingChecks above, with one difference: the external fetch per
  // snapshot is slow and allowed to fail independently (the existing
  // per-item try/catch), so it stays outside any DB transaction -- only the
  // read and each individual save are wrapped, each pinning
  // app.aurora_system_job just long enough to satisfy published_content_
  // snapshot's RLS policy, never held open across a network call.
  @Cron(MONITORING_CRON)
  async monitorPublishedContent() {
    const active = await this.dataSource.transaction(async (manager) => {
      await manager.query(`SET LOCAL app.aurora_system_job = 'true'`);
      return manager.getRepository(PublishedContentSnapshot).find({
        where: { monitoringStatus: MonitoringStatus.ACTIVE },
      });
    });
    if (active.length === 0) return;

    for (const snapshot of active) {
      try {
        const fetchResult = await this.liveContentFetcher.fetchLiveCaption(snapshot.publishedUrl);

        if (!fetchResult.reachable) {
          // US-16b scenario 3: never reported as matching simply because
          // there is nothing left to compare.
          snapshot.lastResult = MonitoringResult.UNREACHABLE;
          snapshot.deviationDetails = { reason: 'link_unreachable_or_removed' };
          snapshot.consecutiveUnreachableCount += 1;
        } else if (
          fetchResult.captionText !== undefined &&
          fetchResult.captionText !== snapshot.approvedCaptionText
        ) {
          // US-16b scenario 2: states what changed, not just "a difference exists."
          snapshot.lastResult = MonitoringResult.DEVIATED;
          snapshot.deviationDetails = {
            field: 'caption_text',
            approved: snapshot.approvedCaptionText,
            current: fetchResult.captionText,
          };
          snapshot.consecutiveUnreachableCount = 0;
        } else {
          snapshot.lastResult = MonitoringResult.MATCHING;
          snapshot.deviationDetails = null;
          snapshot.consecutiveUnreachableCount = 0;
        }

        snapshot.lastCheckedAt = new Date();
        await this.dataSource.transaction(async (manager) => {
          await manager.query(`SET LOCAL app.aurora_system_job = 'true'`);
          await manager.getRepository(PublishedContentSnapshot).save(snapshot);
        });
      } catch (error) {
        this.logger.warn(
          `monitor-published-content failed for snapshot ${snapshot.id}: ${(error as Error).message}`,
        );
      }
    }
  }
}
