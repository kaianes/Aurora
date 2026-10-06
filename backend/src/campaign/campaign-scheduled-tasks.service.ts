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
  ) {}

  // Enqueues a reallocate-budget job for every active campaign that has
  // opted into reallocation. The metrics feed integration (FR-52) does not
  // exist yet in E2's scope, so metricsFeedAvailable is reported false until
  // that integration lands; the job correctly skips and logs rather than
  // acting on absent data (US-10 scenario 3).
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
      await this.campaignQueue.add('reallocate-budget', {
        campaignId,
        metricsFeedAvailable: false,
        performance: [],
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
