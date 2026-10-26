import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
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
    @InjectRepository(SafetyCheck)
    private checkRepo: Repository<SafetyCheck>,
    @InjectRepository(SafetyRuleTrigger)
    private triggerRepo: Repository<SafetyRuleTrigger>,
    @InjectRepository(SafetyReviewQueueItem)
    private reviewRepo: Repository<SafetyReviewQueueItem>,
    @InjectRepository(PublishedContentSnapshot)
    private snapshotRepo: Repository<PublishedContentSnapshot>,
    @Inject(LIVE_CONTENT_FETCHER)
    private liveContentFetcher: LiveContentFetcher,
    private auditService: AuditService,
  ) {}

  // ADR-0022: the single mechanism that transitions a stuck pending check to
  // check_unavailable, bounded by the hard timeout. Blocks publication
  // identically to a flag and routes to the same human review queue.
  @Cron(EXPIRE_PENDING_CHECKS_CRON)
  async expirePendingChecks() {
    const stale = await this.checkRepo.find({
      where: { status: SafetyCheckStatus.PENDING, timeoutAt: LessThan(new Date()) },
    });
    if (stale.length === 0) return;

    for (const check of stale) {
      check.status = SafetyCheckStatus.CHECK_UNAVAILABLE;
      check.resolvedAt = new Date();
      await this.checkRepo.save(check);

      // Exactly one channel = 'system', rule_id = null row, so the review
      // queue has something honest to display without a fake rule citation.
      await this.triggerRepo.save(
        this.triggerRepo.create({
          safetyCheckId: check.id,
          ruleId: null,
          channel: SafetyTriggerChannel.SYSTEM,
          matchedExcerpt: null,
          tier: check.tierReached || SafetyCheckTier.TIER1,
        }),
      );

      await this.reviewRepo.save(
        this.reviewRepo.create({
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
  }

  // ADR-0024: one cheap fetch-and-compare per published post per cycle,
  // never a full cascade re-run. Overwrites the previous result in place --
  // no history table (section 2.2 of the E4 architecture doc).
  @Cron(MONITORING_CRON)
  async monitorPublishedContent() {
    const active = await this.snapshotRepo.find({
      where: { monitoringStatus: MonitoringStatus.ACTIVE },
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
        await this.snapshotRepo.save(snapshot);
      } catch (error) {
        this.logger.warn(
          `monitor-published-content failed for snapshot ${snapshot.id}: ${(error as Error).message}`,
        );
      }
    }
  }
}
