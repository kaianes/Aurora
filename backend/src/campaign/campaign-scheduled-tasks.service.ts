import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { LessThan, Repository } from 'typeorm';
import {
  CampaignQuote,
  CampaignQuoteStatus,
  Campaign,
  CampaignState,
  ReallocationBounds,
} from '../database/entities';
import { PerformanceScoringService } from '../analytics/performance-scoring.service';

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
