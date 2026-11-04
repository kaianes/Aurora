import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { LessThan, LessThanOrEqual, Repository } from 'typeorm';
import {
  CampaignQuote,
  CampaignQuoteStatus,
  Campaign,
  CampaignState,
  CampaignStateTransition,
  ReallocationBounds,
} from '../database/entities';
import { PerformanceScoringService } from '../analytics/performance-scoring.service';
import { AuditService } from '../audit/audit.service';

const PENDING_QUOTE_SAFETY_WINDOW_MS = (90 + 120) * 1000; // 90s timeout + 2min safety net

@Injectable()
export class CampaignScheduledTasksService {
  private readonly logger = new Logger(CampaignScheduledTasksService.name);

  constructor(
    @InjectRepository(CampaignQuote)
    private quoteRepo: Repository<CampaignQuote>,
    @InjectRepository(Campaign)
    private campaignRepo: Repository<Campaign>,
    @InjectRepository(ReallocationBounds)
    private boundsRepo: Repository<ReallocationBounds>,
    @InjectQueue('campaign')
    private campaignQueue: Queue,
    private performanceScoringService: PerformanceScoringService,
    @InjectRepository(CampaignStateTransition)
    private transitionRepo: Repository<CampaignStateTransition>,
    private auditService: AuditService,
  ) {}

  // Enqueues a reallocate-budget job for every active campaign that has
  // opted into reallocation. metricsFeedAvailable/performance now come from
  // E7's exported PerformanceScoringService.getReallocationInputs
  // (ADR-0047), replacing the hardcoded metricsFeedAvailable: false,
  // performance: [] literals this method used before E7's metrics feed
  // (FR-52) existed. The job itself (reallocation.processor.ts) still
  // correctly skips and logs when a given cycle's feed is unavailable
  // (US-10 scenario 3) -- that behavior is unchanged.
  @Cron(CronExpression.EVERY_6_HOURS)
  async scheduleReallocation() {
    const enabledBounds = await this.boundsRepo.find({ where: { enabled: true } });
    if (enabledBounds.length === 0) return;

    const campaignIds = enabledBounds.map((b) => b.campaignId);
    const activeCampaigns = await this.campaignRepo.find({
      where: { state: CampaignState.ACTIVE },
    });
    const activeIds = new Set(activeCampaigns.map((c) => c.id));

    for (const campaignId of campaignIds) {
      if (!activeIds.has(campaignId)) continue;
      const { metricsFeedAvailable, performance } =
        await this.performanceScoringService.getReallocationInputs(campaignId);
      await this.campaignQueue.add('reallocate-budget', {
        campaignId,
        metricsFeedAvailable,
        performance,
      });
    }
  }

  // E2 architecture section 2.6: the "launch date reached (scheduled job)"
  // half of confirmed -> active. CampaignService.confirm() already handles
  // the "immediate launch if timeline_start <= now" half synchronously at
  // confirm time -- any campaign still sitting in confirmed by the time
  // this runs necessarily has a future timeline_start (confirmed campaigns
  // aren't editable, so it can't have been pushed into the past since).
  // No system-attributable user for this transition (actorUserId: null),
  // same convention as every other cron-triggered state change in this
  // codebase (e.g. BrandSafetyScheduledTasksService.expirePendingChecks).
  @Cron(CronExpression.EVERY_5_MINUTES)
  async activateDueCampaigns() {
    const due = await this.campaignRepo.find({
      where: { state: CampaignState.CONFIRMED, timelineStart: LessThanOrEqual(new Date()) },
    });
    if (due.length === 0) return;

    for (const campaign of due) {
      campaign.state = CampaignState.ACTIVE;
      await this.campaignRepo.save(campaign);

      const transition = this.transitionRepo.create({
        campaignId: campaign.id,
        fromState: CampaignState.CONFIRMED,
        toState: CampaignState.ACTIVE,
        actorUserId: null,
      });
      await this.transitionRepo.save(transition);

      await this.auditService.log({
        actorUserId: null,
        targetAccountId: campaign.accountId,
        action: 'campaign.activated',
        metadata: { campaign_id: campaign.id, trigger: 'timeline_start_reached' },
      });
    }
    this.logger.log(`Activated ${due.length} campaign(s) whose launch date was reached`);
  }

  // Safety net for a crashed worker: any quote stuck pending past its
  // timeout window is marked failed so the frontend poll loop terminates.
  @Cron('0 */15 * * * *')
  async expirePendingQuotes() {
    const cutoff = new Date(Date.now() - PENDING_QUOTE_SAFETY_WINDOW_MS);
    const result = await this.quoteRepo.update(
      { status: CampaignQuoteStatus.PENDING, requestedAt: LessThan(cutoff) },
      {
        status: CampaignQuoteStatus.FAILED,
        failureReason: 'Nao foi possivel calcular a cotacao agora. Tente novamente em alguns minutos.',
        resolvedAt: new Date(),
      },
    );
    if (result.affected && result.affected > 0) {
      this.logger.log(`Expired ${result.affected} stuck pending quotes`);
    }
  }
}
