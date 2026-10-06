import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Creator,
  CreatorStatus,
  CreatorOnboardingStatus,
} from '../database/entities';
import {
  MatchingEngineAdapter,
  EstimatePoolInput,
  EstimatePoolResult,
  GenerateShortlistInput,
  GenerateShortlistResult,
  GenerateShortlistEntry,
} from '../campaign/matching-engine.adapter';
import { AudienceTargeting } from '../database/entities/campaign.entity';
import { MATCHING_WEIGHTS } from './matching-config';

const PRICE_PER_CREATOR_PER_FORMAT = 350; // BRL, same pilot rate as E2's stub

// Replaces StubMatchingEngineAdapter (ADR-0011). Ranks real creator rows with
// a transparent, weighted multi-signal score instead of a learned model, so
// every ranking decision is traceable to specific, named signals (FR-26).
// Bound to the same MATCHING_ENGINE_ADAPTER DI token campaign already
// consumes; estimatePool's contract is unchanged, only its implementation
// moves from a heuristic to a real query against the creator table.
@Injectable()
export class RealMatchingEngineAdapter implements MatchingEngineAdapter {
  constructor(
    @InjectRepository(Creator)
    private creatorRepo: Repository<Creator>,
  ) {}

  async estimatePool(input: EstimatePoolInput): Promise<EstimatePoolResult> {
    const targeting = input.audienceTargeting || {};
    const formats = input.deliverableFormats || [];

    if (this.isZeroAddressable(targeting)) {
      return { noViablePool: true };
    }

    const eligibleCount = await this.countEligible(targeting, []);
    if (eligibleCount === 0) {
      return { noViablePool: true };
    }

    const budget = parseFloat(input.budgetAmount) || 0;
    const formatCount = Math.max(formats.length, 1);
    const costPerCreator = PRICE_PER_CREATOR_PER_FORMAT * formatCount;

    const budgetCappedPoolSize = Math.max(
      1,
      Math.floor(budget / Math.max(costPerCreator, 1)),
    );
    const guaranteedMinPoolSize = Math.max(
      1,
      Math.min(budgetCappedPoolSize, eligibleCount, 150),
    );

    return {
      guaranteedMinPoolSize,
      projectedReachLow: guaranteedMinPoolSize * 4000,
      projectedReachHigh: guaranteedMinPoolSize * 7500,
      totalPrice:
        budget > 0
          ? budget.toFixed(2)
          : (guaranteedMinPoolSize * costPerCreator).toFixed(2),
    };
  }

  // Scores and ranks the eligible candidate set in a single batched query
  // (NFR-01, NFR-06). The hard eligibility gate (exclusions, status,
  // onboarding, zero audience-attribute overlap) runs once, before scoring
  // (ADR-0011, FR-27's "applied before a shortlist is produced").
  async generateShortlist(
    input: GenerateShortlistInput,
  ): Promise<GenerateShortlistResult> {
    const targeting = input.audienceTargeting || {};
    const excluded = new Set([
      ...input.excludedCreatorIds,
      ...input.alreadyOnShortlistCreatorIds,
    ]);

    const candidates = await this.eligibleCandidates(targeting, excluded, input.maxCandidates);
    if (candidates.length === 0) {
      return { status: 'no_viable_pool' };
    }

    const engagementRates = candidates.map((c) => parseFloat(c.engagementRate || '0'));
    const maxEngagement = Math.max(...engagementRates, 0.0001);

    const scored = candidates.map((creator) => {
      const { score: attributeScore, matchedAttributes } = this.audienceAttributeMatch(
        creator,
        targeting,
      );
      const authenticity = parseFloat(creator.authenticityScore || '0') / 100;
      const engagementRate = parseFloat(creator.engagementRate || '0');
      const engagementPercentile = maxEngagement > 0 ? engagementRate / maxEngagement : 0;
      const historicalReliability =
        creator.historicalReliability !== null && creator.historicalReliability !== undefined
          ? parseFloat(creator.historicalReliability)
          : 0.5; // neutral default for creators with no history (ADR-0011)

      const fitScore =
        MATCHING_WEIGHTS.audienceAttributeMatch * attributeScore +
        MATCHING_WEIGHTS.authenticity * authenticity +
        MATCHING_WEIGHTS.engagementPercentile * engagementPercentile +
        MATCHING_WEIGHTS.historicalReliability * historicalReliability;

      return { creator, fitScore, matchedAttributes };
    });

    scored.sort((a, b) => b.fitScore - a.fitScore);

    const entries: GenerateShortlistEntry[] = scored
      .slice(0, input.maxCandidates)
      .map((s, index) => ({
        creatorId: s.creator.id,
        rank: index + 1,
        fitScore: Math.round(s.fitScore * 10000) / 10000,
        matchedAttributes: s.matchedAttributes,
      }));

    return { status: 'ready', entries };
  }

  // ---- Eligibility and scoring helpers ----

  private isZeroAddressable(targeting: AudienceTargeting): boolean {
    const geographyProvided = 'geography' in targeting;
    const interestsProvided = 'interests' in targeting;
    const geoCount = targeting.geography?.length || 0;
    const interestCount = targeting.interests?.length || 0;
    const noGeography = geographyProvided && geoCount === 0;
    const noInterests = interestsProvided && interestCount === 0;
    const zeroAgeSpan =
      Array.isArray(targeting.age_range) &&
      targeting.age_range.length === 2 &&
      targeting.age_range[1] <= targeting.age_range[0];
    return noGeography || noInterests || zeroAgeSpan;
  }

  private async countEligible(
    targeting: AudienceTargeting,
    excludedCreatorIds: string[],
  ): Promise<number> {
    const candidates = await this.eligibleCandidates(targeting, new Set(excludedCreatorIds), 150);
    return candidates.length;
  }

  // Hard eligibility gate: excluded, inactive, or unqualified creators never
  // enter scoring (ADR-0011). Authenticity score is deliberately not part of
  // this gate (ADR-0017) -- it affects display only, never eligibility.
  private async eligibleCandidates(
    targeting: AudienceTargeting,
    excludedCreatorIds: Set<string>,
    maxCandidates: number,
  ): Promise<Creator[]> {
    const qb = this.creatorRepo
      .createQueryBuilder('c')
      .where('c.status = :status', { status: CreatorStatus.ACTIVE })
      .andWhere('c.onboardingStatus = :onboardingStatus', {
        onboardingStatus: CreatorOnboardingStatus.QUALIFIED,
      })
      .limit(Math.min(maxCandidates, 150) * 3); // headroom before the attribute-overlap filter

    if (excludedCreatorIds.size > 0) {
      qb.andWhere('c.id NOT IN (:...excludedIds)', {
        excludedIds: Array.from(excludedCreatorIds),
      });
    }

    const rows = await qb.getMany();

    if (this.isZeroAddressable(targeting)) {
      return [];
    }

    // Zero audience-attribute overlap excludes a candidate from scoring
    // entirely (ADR-0011).
    const filtered = rows.filter((c) => this.audienceAttributeMatch(c, targeting).score > 0);
    return filtered.slice(0, maxCandidates);
  }

  // matched_attributes (FR-26) is derived directly from which targeting
  // dimensions contributed non-zero overlap, a byproduct of scoring itself.
  private audienceAttributeMatch(
    creator: Creator,
    targeting: AudienceTargeting,
  ): { score: number; matchedAttributes: string[] } {
    const dimensions: string[] = [];
    const matched: string[] = [];

    if (targeting.geography && targeting.geography.length > 0) {
      dimensions.push('geography');
      // Minimal creator entity (ADR-0013) has no geography field yet (E8
      // scope); treat geography targeting as satisfied until that data
      // exists, rather than silently excluding every creator on a dimension
      // Aurora cannot yet measure.
      matched.push(`geography:${targeting.geography[0]}`);
    }
    if (targeting.interests && targeting.interests.length > 0) {
      dimensions.push('interests');
      const niche = (creator.contentNiche || '').toLowerCase();
      const hit = targeting.interests.find((i) => niche.includes(i.toLowerCase()));
      if (hit) matched.push(`interests:${hit}`);
    }
    if (targeting.age_range) {
      dimensions.push('age_range');
      matched.push(`age_range:${targeting.age_range[0]}-${targeting.age_range[1]}`);
    }
    if (targeting.gender) {
      dimensions.push('gender');
      matched.push(`gender:${targeting.gender}`);
    }

    if (dimensions.length === 0) {
      // No targeting dimensions specified: every qualified creator matches
      // with full overlap (nothing to disqualify them on).
      return { score: 1, matchedAttributes: [] };
    }

    const score = matched.length / dimensions.length;
    return { score, matchedAttributes: matched };
  }
}
