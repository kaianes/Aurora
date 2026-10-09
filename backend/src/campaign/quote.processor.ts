import { Process, Processor } from '@nestjs/bull';
import { Inject, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from 'bull';
import {
  Campaign,
  CampaignState,
  CampaignQuote,
  CampaignQuoteStatus,
  CampaignStateTransition,
} from '../database/entities';
import { AuditService } from '../audit/audit.service';
import {
  MATCHING_ENGINE_ADAPTER,
  MatchingEngineAdapter,
} from './matching-engine.adapter';

const QUOTE_TIMEOUT_MS = 90_000;

@Processor('campaign')
export class QuoteProcessor {
  private readonly logger = new Logger(QuoteProcessor.name);

  constructor(
    @InjectRepository(Campaign)
    private campaignRepo: Repository<Campaign>,
    @InjectRepository(CampaignQuote)
    private quoteRepo: Repository<CampaignQuote>,
    @InjectRepository(CampaignStateTransition)
    private transitionRepo: Repository<CampaignStateTransition>,
    @Inject(MATCHING_ENGINE_ADAPTER)
    private matchingEngine: MatchingEngineAdapter,
    private auditService: AuditService,
  ) {}

  @Process('compute-quote')
  async handleComputeQuote(job: Job<{ campaignId: string; quoteId: string }>) {
    const { campaignId, quoteId } = job.data;
    const quote = await this.quoteRepo.findOne({ where: { id: quoteId } });
    const campaign = await this.campaignRepo.findOne({ where: { id: campaignId } });

    if (!quote || !campaign) {
      this.logger.warn(`compute-quote: campaign or quote not found (${campaignId}/${quoteId})`);
      return;
    }

    try {
      const result = await this.withTimeout(
        this.matchingEngine.estimatePool({
          accountId: campaign.accountId,
          audienceTargeting: campaign.audienceTargeting,
          deliverableFormats: campaign.deliverableFormats,
          budgetAmount: campaign.budgetAmount || '0',
        }),
        QUOTE_TIMEOUT_MS,
      );

      if ('noViablePool' in result) {
        quote.status = CampaignQuoteStatus.NO_VIABLE_POOL;
        quote.failureReason =
          'Nenhum criador disponivel para esta combinacao de publico. Tente ampliar a geografia ou os interesses.';
        quote.resolvedAt = new Date();
        await this.quoteRepo.save(quote);

        await this.auditService.log({
          actorUserId: null,
          targetAccountId: campaign.accountId,
          action: 'campaign.quote_failed',
          metadata: { campaign_id: campaignId, quote_id: quoteId, reason: 'no_viable_pool' },
        });
        return;
      }

      quote.status = CampaignQuoteStatus.READY;
      quote.guaranteedMinPoolSize = result.guaranteedMinPoolSize;
      quote.projectedReachLow = result.projectedReachLow;
      quote.projectedReachHigh = result.projectedReachHigh;
      quote.totalPrice = result.totalPrice;
      quote.resolvedAt = new Date();
      await this.quoteRepo.save(quote);

      const fromState = campaign.state;
      campaign.state = CampaignState.QUOTED;
      await this.campaignRepo.save(campaign);
      await this.transitionRepo.save(
        this.transitionRepo.create({
          campaignId,
          fromState,
          toState: CampaignState.QUOTED,
          actorUserId: null,
        }),
      );

      await this.auditService.log({
        actorUserId: null,
        targetAccountId: campaign.accountId,
        action: 'campaign.quote_ready',
        metadata: { campaign_id: campaignId, quote_id: quoteId },
      });
    } catch (error) {
      this.logger.error(`compute-quote failed for ${campaignId}: ${(error as Error).message}`);
      quote.status = CampaignQuoteStatus.FAILED;
      quote.failureReason =
        'Nao foi possivel calcular a cotacao agora. Tente novamente em alguns minutos.';
      quote.resolvedAt = new Date();
      await this.quoteRepo.save(quote);

      await this.auditService.log({
        actorUserId: null,
        targetAccountId: campaign.accountId,
        action: 'campaign.quote_failed',
        metadata: { campaign_id: campaignId, quote_id: quoteId, reason: 'timeout_or_error' },
      });
    }
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('matching engine timeout')),
        timeoutMs,
      );
      promise
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }
}
