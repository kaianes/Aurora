import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Creator, CampaignShortlistEntry } from '../database/entities';
import { authenticityFlag } from './matching-config';

@Injectable()
export class CreatorMetricsService {
  constructor(
    @InjectRepository(Creator)
    private creatorRepo: Repository<Creator>,
    @InjectRepository(CampaignShortlistEntry)
    private entryRepo: Repository<CampaignShortlistEntry>,
  ) {}

  // US-12: audience/authenticity metrics, in the context of a shortlist when
  // campaign_id is given. Never hides or blanks stale metrics (scenario 3),
  // never omits a low authenticity score (scenario 2), never removes the
  // creator from any shortlist as a side effect (ADR-0017).
  async getMetrics(creatorId: string, accountId: string, campaignId?: string) {
    const creator = await this.creatorRepo.findOne({ where: { id: creatorId } });
    if (!creator) {
      throw new NotFoundException({
        error: { code: 'CREATOR_NOT_FOUND', message: 'Criador nao encontrado.', details: {} },
      });
    }

    let matchedAttributes: string[] | null = null;
    if (campaignId) {
      const entry = await this.entryRepo.findOne({
        where: { campaignId, creatorId },
      });
      if (entry && entry.matchedAttributes) {
        matchedAttributes = entry.matchedAttributes;
      }
    }

    const authenticityScore =
      creator.authenticityScore !== null ? Number(creator.authenticityScore) : null;

    const base: Record<string, any> = {
      creator_id: creator.id,
      display_name: creator.displayName,
      audience_size: creator.audienceSize,
      demographic_composition: creator.demographicComposition,
      engagement_rate: creator.engagementRate,
      content_niche: creator.contentNiche,
      authenticity_score: authenticityScore,
      authenticity_flag: authenticityFlag(authenticityScore),
      metrics_computed_at: creator.metricsComputedAt?.toISOString() || null,
      metrics_stale: creator.metricsStale,
      matched_attributes: matchedAttributes,
    };

    if (creator.metricsStale) {
      base.stale_since = creator.metricsComputedAt?.toISOString() || null;
    }

    return base;
  }
}
