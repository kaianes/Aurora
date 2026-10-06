import { Process, Processor } from '@nestjs/bull';
import { Inject, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from 'bull';
import {
  Campaign,
  CampaignShortlist,
  ShortlistStatus,
  CampaignShortlistEntry,
  ShortlistEntryOrigin,
  AdditionalCandidatesRequest,
  AdditionalCandidatesRequestStatus,
} from '../database/entities';
import { AuditService } from '../audit/audit.service';
import { ExclusionService } from './exclusion.service';
import {
  MATCHING_ENGINE_ADAPTER,
  MatchingEngineAdapter,
} from '../campaign/matching-engine.adapter';

const SHORTLIST_TIMEOUT_MS = 90_000; // 90s hard cutoff, mirrors E2's quote job (NFR-01)

@Processor('matching')
export class GenerateShortlistProcessor {
  private readonly logger = new Logger(GenerateShortlistProcessor.name);

  constructor(
    @InjectRepository(Campaign)
    private campaignRepo: Repository<Campaign>,
    @InjectRepository(CampaignShortlist)
    private shortlistRepo: Repository<CampaignShortlist>,
    @InjectRepository(CampaignShortlistEntry)
    private entryRepo: Repository<CampaignShortlistEntry>,
    @InjectRepository(AdditionalCandidatesRequest)
    private requestRepo: Repository<AdditionalCandidatesRequest>,
    @Inject(MATCHING_ENGINE_ADAPTER)
    private matchingEngine: MatchingEngineAdapter,
    private exclusionService: ExclusionService,
    private auditService: AuditService,
  ) {}

  @Process('generate-shortlist')
  async handleGenerateShortlist(
    job: Job<{ campaignId: string; shortlistId: string }>,
  ) {
    const { campaignId, shortlistId } = job.data;
    const campaign = await this.campaignRepo.findOne({ where: { id: campaignId } });
    const shortlist = await this.shortlistRepo.findOne({ where: { id: shortlistId } });

    if (!campaign || !shortlist) {
      this.logger.warn(`generate-shortlist: campaign or shortlist not found (${campaignId}/${shortlistId})`);
      return;
    }

    try {
      const excludedCreatorIds = await this.exclusionService.resolveExcludedCreatorIds(
        campaign.accountId,
        campaignId,
      );

      const result = await this.withTimeout(
        this.matchingEngine.generateShortlist({
          campaignId,
          accountId: campaign.accountId,
          audienceTargeting: campaign.audienceTargeting,
          deliverableFormats: campaign.deliverableFormats,
          guaranteedMinPoolSize: campaign.guaranteedMinPoolSize || 0,
          excludedCreatorIds,
          alreadyOnShortlistCreatorIds: [],
          maxCandidates: 150,
        }),
        SHORTLIST_TIMEOUT_MS,
      );

      if (result.status === 'no_viable_pool') {
        shortlist.status = ShortlistStatus.NO_VIABLE_POOL;
        shortlist.resolvedAt = new Date();
        await this.shortlistRepo.save(shortlist);

        await this.auditService.log({
          actorUserId: null,
          targetAccountId: campaign.accountId,
          action: 'shortlist.no_viable_pool',
          metadata: { campaign_id: campaignId, shortlist_id: shortlistId },
        });
        return;
      }

      const entries = result.entries.map((e) =>
        this.entryRepo.create({
          shortlistId,
          campaignId,
          creatorId: e.creatorId,
          rank: e.rank,
          fitScore: e.fitScore.toString(),
          matchedAttributes: e.matchedAttributes,
          origin: ShortlistEntryOrigin.SYSTEM_RANKED,
        }),
      );
      await this.entryRepo.save(entries);

      shortlist.status = ShortlistStatus.READY;
      shortlist.belowGuaranteedMinimum = entries.length < (campaign.guaranteedMinPoolSize || 0);
      shortlist.resolvedAt = new Date();
      await this.shortlistRepo.save(shortlist);

      await this.auditService.log({
        actorUserId: null,
        targetAccountId: campaign.accountId,
        action: 'shortlist.ready',
        metadata: { campaign_id: campaignId, shortlist_id: shortlistId, entry_count: entries.length },
      });
    } catch (error) {
      this.logger.error(`generate-shortlist failed for ${campaignId}: ${(error as Error).message}`);
      shortlist.status = ShortlistStatus.FAILED;
      shortlist.failureReason =
        'Nao foi possivel gerar o shortlist agora. Tente novamente em alguns minutos.';
      shortlist.resolvedAt = new Date();
      await this.shortlistRepo.save(shortlist);

      await this.auditService.log({
        actorUserId: null,
        targetAccountId: campaign.accountId,
        action: 'shortlist.failed',
        metadata: { campaign_id: campaignId, shortlist_id: shortlistId, reason: 'timeout_or_error' },
      });
    }
  }

  // ADR-0018: top-up against the existing shortlist and locked price, never
  // a new quote. Targets only the remaining shortfall and excludes everyone
  // already on the shortlist (any decision).
  @Process('top-up-shortlist')
  async handleTopUpShortlist(
    job: Job<{ campaignId: string; shortlistId: string; requestId: string }>,
  ) {
    const { campaignId, shortlistId, requestId } = job.data;
    const campaign = await this.campaignRepo.findOne({ where: { id: campaignId } });
    const shortlist = await this.shortlistRepo.findOne({ where: { id: shortlistId } });
    const request = await this.requestRepo.findOne({ where: { id: requestId } });

    if (!campaign || !shortlist || !request) {
      this.logger.warn(`top-up-shortlist: missing data for request ${requestId}`);
      return;
    }

    const existingEntries = await this.entryRepo.find({ where: { shortlistId } });
    const alreadyOnShortlistCreatorIds = existingEntries.map((e) => e.creatorId);

    try {
      const excludedCreatorIds = await this.exclusionService.resolveExcludedCreatorIds(
        campaign.accountId,
        campaignId,
      );

      const result = await this.withTimeout(
        this.matchingEngine.generateShortlist({
          campaignId,
          accountId: campaign.accountId,
          audienceTargeting: campaign.audienceTargeting,
          deliverableFormats: campaign.deliverableFormats,
          guaranteedMinPoolSize: request.requestedCount,
          excludedCreatorIds,
          alreadyOnShortlistCreatorIds,
          maxCandidates: request.requestedCount,
        }),
        SHORTLIST_TIMEOUT_MS,
      );

      if (result.status === 'no_viable_pool' || result.entries.length === 0) {
        request.status = AdditionalCandidatesRequestStatus.NO_ADDITIONAL_CANDIDATES;
        request.resolvedAt = new Date();
        await this.requestRepo.save(request);

        await this.auditService.log({
          actorUserId: null,
          targetAccountId: campaign.accountId,
          action: 'shortlist.no_additional_candidates',
          metadata: { campaign_id: campaignId, request_id: requestId },
        });
        return;
      }

      const baseRank = existingEntries.reduce((max, e) => Math.max(max, e.rank || 0), 0);
      const newEntries = result.entries.map((e, idx) =>
        this.entryRepo.create({
          shortlistId,
          campaignId,
          creatorId: e.creatorId,
          rank: baseRank + idx + 1,
          fitScore: e.fitScore.toString(),
          matchedAttributes: e.matchedAttributes,
          origin: ShortlistEntryOrigin.SYSTEM_RANKED,
        }),
      );
      await this.entryRepo.save(newEntries);

      request.status = AdditionalCandidatesRequestStatus.FULFILLED;
      request.resolvedAt = new Date();
      await this.requestRepo.save(request);

      await this.auditService.log({
        actorUserId: null,
        targetAccountId: campaign.accountId,
        action: 'shortlist.additional_candidates_fulfilled',
        metadata: { campaign_id: campaignId, request_id: requestId, added: newEntries.length },
      });
    } catch (error) {
      this.logger.error(`top-up-shortlist failed for ${campaignId}: ${(error as Error).message}`);
      request.status = AdditionalCandidatesRequestStatus.NO_ADDITIONAL_CANDIDATES;
      request.resolvedAt = new Date();
      await this.requestRepo.save(request);
    }
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('matching engine timeout')), timeoutMs);
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
