import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThanOrEqual, Not, Repository } from 'typeorm';
import {
  Campaign,
  CampaignOpportunity,
  CampaignPerformanceAggregate,
  CampaignPoolMember,
  ContentSubmission,
  ContentSubmissionMetricSnapshot,
  IngestionAttemptOutcome,
  IngestionStatus,
  PerformanceMetricIngestionAttempt,
} from '../database/entities';
import { AUTH_REVOKED_RETRY_HOURS, derivePlatformFromFormat } from './analytics.config';
import { SOCIAL_METRICS_ADAPTER, SocialMetricsAdapter } from './adapters/social-metrics.adapter';

// US-21a / FR-52 (ADR-0044, ADR-0045). The discover-and-ingest-metrics
// pipeline, section 4 of the E7 architecture document, plus
// recomputeAggregate (section 2.2), shared by both the scheduled job and
// anything else in this module that needs a campaign's aggregate refreshed.
@Injectable()
export class MetricsIngestionService {
  private readonly logger = new Logger(MetricsIngestionService.name);

  constructor(
    @InjectRepository(ContentSubmission)
    private submissionRepo: Repository<ContentSubmission>,
    @InjectRepository(ContentSubmissionMetricSnapshot)
    private snapshotRepo: Repository<ContentSubmissionMetricSnapshot>,
    @InjectRepository(PerformanceMetricIngestionAttempt)
    private attemptRepo: Repository<PerformanceMetricIngestionAttempt>,
    @InjectRepository(CampaignPerformanceAggregate)
    private aggregateRepo: Repository<CampaignPerformanceAggregate>,
    @InjectRepository(CampaignPoolMember)
    private poolMemberRepo: Repository<CampaignPoolMember>,
    @InjectRepository(CampaignOpportunity)
    private opportunityRepo: Repository<CampaignOpportunity>,
    @InjectRepository(Campaign)
    private campaignRepo: Repository<Campaign>,
    @Inject(SOCIAL_METRICS_ADAPTER)
    private adapter: SocialMetricsAdapter,
  ) {}

  // Section 4.2, steps 1-4, run as one pass. Returns the set of campaign ids
  // touched, for callers (tests, the scheduled task) that want to observe
  // what was recomputed.
  async runDiscoveryAndIngestion(): Promise<Set<string>> {
    const touchedCampaignIds = new Set<string>();

    const discoveredCampaignIds = await this.discoverNewPublications();
    discoveredCampaignIds.forEach((id) => touchedCampaignIds.add(id));

    const dueSnapshots = await this.snapshotRepo.find({
      where: [
        { ingestionStatus: Not(IngestionStatus.STALE_AUTH_REVOKED) },
        { nextRetryAt: LessThanOrEqual(new Date()) },
      ],
    });

    for (const snapshot of dueSnapshots) {
      await this.pullOne(snapshot);
      touchedCampaignIds.add(snapshot.campaignId);
    }

    for (const campaignId of touchedCampaignIds) {
      await this.recomputeAggregate(campaignId);
    }

    if (touchedCampaignIds.size > 0) {
      this.logger.log(
        `discover-and-ingest-metrics: discovered ${discoveredCampaignIds.size} campaign(s) with new publications, pulled ${dueSnapshots.length} snapshot(s), recomputed ${touchedCampaignIds.size} aggregate(s)`,
      );
    }

    return touchedCampaignIds;
  }

  // Step 1: find every content_submission with published_at set and no
  // snapshot row yet; create one, status pending_first_pull. Never touches
  // content_submission, campaign_opportunity, or any E5/E2 table itself
  // (ADR-0045) -- it only reads published_at to discover work.
  private async discoverNewPublications(): Promise<Set<string>> {
    const touched = new Set<string>();

    const published = await this.submissionRepo.find({
      where: { publishedAt: Not(IsNull()) },
    });

    for (const submission of published) {
      if (!submission.creatorId) continue; // defensive: should always be set once published.

      const existing = await this.snapshotRepo.findOne({
        where: { contentSubmissionId: submission.id },
      });
      if (existing) continue;

      const platform = await this.derivePlatform(submission);

      await this.snapshotRepo.save(
        this.snapshotRepo.create({
          contentSubmissionId: submission.id,
          campaignId: submission.campaignId,
          creatorId: submission.creatorId,
          platform,
          ingestionStatus: IngestionStatus.PENDING_FIRST_PULL,
        }),
      );
      touched.add(submission.campaignId);
    }

    return touched;
  }

  private async derivePlatform(submission: ContentSubmission): Promise<string> {
    if (submission.opportunityId) {
      const opportunity = await this.opportunityRepo.findOne({
        where: { id: submission.opportunityId },
      });
      if (opportunity?.deliverable?.format) {
        return derivePlatformFromFormat(opportunity.deliverable.format);
      }
    }
    const campaign = await this.campaignRepo.findOne({ where: { id: submission.campaignId } });
    return derivePlatformFromFormat(campaign?.deliverableFormats?.[0]);
  }

  // Steps 2-3: pull, then update. A failed pull never blanks the snapshot's
  // last-known reach/engagement/impressions (NFR-35); only ingestion_status
  // and the timestamp fields change.
  private async pullOne(snapshot: ContentSubmissionMetricSnapshot): Promise<void> {
    const submission = await this.submissionRepo.findOne({
      where: { id: snapshot.contentSubmissionId },
    });
    const publishedUrl = submission?.publishedUrl || '';

    const result = await this.adapter.pullMetrics({
      creatorId: snapshot.creatorId,
      contentSubmissionId: snapshot.contentSubmissionId,
      platform: snapshot.platform,
      publishedUrl,
    });

    const now = new Date();
    snapshot.lastAttemptedPullAt = now;

    let attemptOutcome: IngestionAttemptOutcome;
    let attemptReach: number | null = null;
    let attemptEngagement: number | null = null;
    let attemptImpressions: number | null = null;

    if (result.outcome === 'success') {
      attemptOutcome = IngestionAttemptOutcome.SUCCESS;
      attemptReach = result.reach;
      attemptEngagement = result.engagement;
      attemptImpressions = result.impressions;

      snapshot.reach = result.reach;
      snapshot.engagement = result.engagement;
      snapshot.impressions = result.impressions;
      snapshot.ingestionStatus = IngestionStatus.FRESH;
      snapshot.lastSuccessfulPullAt = now;
      snapshot.consecutiveFailureCount = 0;
      snapshot.nextRetryAt = null;
    } else if (result.outcome === 'rate_limited' || result.outcome === 'unreachable') {
      attemptOutcome =
        result.outcome === 'rate_limited'
          ? IngestionAttemptOutcome.RATE_LIMITED
          : IngestionAttemptOutcome.UNREACHABLE;
      snapshot.ingestionStatus =
        result.outcome === 'rate_limited'
          ? IngestionStatus.STALE_RATE_LIMITED
          : IngestionStatus.STALE_UNREACHABLE;
      snapshot.consecutiveFailureCount += 1;
      // Retried on the plain next 4-hour cycle -- this is the backoff at
      // pilot scale (NFR-35, section 4.2).
      snapshot.nextRetryAt = null;
    } else {
      // auth_revoked: logged and surfaced distinctly from a transient
      // failure (US-21a scenario 3), with a longer wait before retrying.
      attemptOutcome = IngestionAttemptOutcome.AUTH_REVOKED;
      snapshot.ingestionStatus = IngestionStatus.STALE_AUTH_REVOKED;
      snapshot.consecutiveFailureCount += 1;
      snapshot.nextRetryAt = new Date(now.getTime() + AUTH_REVOKED_RETRY_HOURS * 60 * 60 * 1000);
    }

    const savedSnapshot = await this.snapshotRepo.save(snapshot);

    await this.attemptRepo.save(
      this.attemptRepo.create({
        contentSubmissionMetricSnapshotId: savedSnapshot.id,
        campaignId: savedSnapshot.campaignId,
        creatorId: savedSnapshot.creatorId,
        attemptedAt: now,
        outcome: attemptOutcome,
        reach: attemptReach,
        engagement: attemptEngagement,
        impressions: attemptImpressions,
      }),
    );
  }

  // Step 4 (section 2.2): one row per campaign, recomputed inline. Totals
  // are summed only over delivered creators' current snapshot values; a
  // creator who is delivered (published_at set) but whose snapshot has not
  // been pulled yet (or has not even been discovered yet, within the
  // bounded delay ADR-0045 accepts) contributes to delivered_creator_count
  // but not to the totals, and marks any_stale.
  async recomputeAggregate(campaignId: string): Promise<void> {
    const members = await this.poolMemberRepo.find({ where: { campaignId } });

    let deliveredCount = 0;
    let pendingCount = 0;
    let totalReach = 0n;
    let totalEngagement = 0n;
    let totalImpressions = 0n;
    let anyStale = false;

    for (const member of members) {
      const opportunity = await this.opportunityRepo.findOne({
        where: { campaignId, creatorId: member.creatorId },
      });

      const submission = opportunity
        ? await this.submissionRepo.findOne({
            where: { opportunityId: opportunity.id, campaignId, publishedAt: Not(IsNull()) },
          })
        : null;

      if (!submission) {
        pendingCount += 1;
        continue;
      }

      deliveredCount += 1;

      const snapshot = await this.snapshotRepo.findOne({
        where: { contentSubmissionId: submission.id },
      });

      if (!snapshot) {
        // Discovered but not yet snapshotted (within one cycle's bounded
        // delay) -- no figures to add yet, treated conservatively as stale.
        anyStale = true;
        continue;
      }

      totalReach += BigInt(snapshot.reach ?? 0);
      totalEngagement += BigInt(snapshot.engagement ?? 0);
      totalImpressions += BigInt(snapshot.impressions ?? 0);
      if (snapshot.ingestionStatus !== IngestionStatus.FRESH) {
        anyStale = true;
      }
    }

    let aggregate = await this.aggregateRepo.findOne({ where: { campaignId } });
    if (!aggregate) {
      aggregate = this.aggregateRepo.create({ campaignId });
    }

    aggregate.deliveredCreatorCount = deliveredCount;
    aggregate.pendingDeliveryCreatorCount = pendingCount;
    aggregate.totalDeliveredReach = totalReach.toString();
    aggregate.totalDeliveredEngagement = totalEngagement.toString();
    aggregate.totalDeliveredImpressions = totalImpressions.toString();
    aggregate.anyStale = anyStale;
    aggregate.lastComputedAt = new Date();

    await this.aggregateRepo.save(aggregate);
  }
}
