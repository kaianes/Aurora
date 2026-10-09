import { Injectable } from '@nestjs/common';
import { AudienceTargeting } from '../database/entities';

export interface EstimatePoolInput {
  accountId: string;
  audienceTargeting: AudienceTargeting | null;
  deliverableFormats: string[] | null;
  budgetAmount: string;
}

export interface EstimatePoolReady {
  guaranteedMinPoolSize: number;
  projectedReachLow: number;
  projectedReachHigh: number;
  totalPrice: string;
}

export interface EstimatePoolNoViablePool {
  noViablePool: true;
}

export type EstimatePoolResult = EstimatePoolReady | EstimatePoolNoViablePool;

export interface GenerateShortlistInput {
  campaignId: string;
  accountId: string;
  audienceTargeting: AudienceTargeting | null;
  deliverableFormats: string[] | null;
  guaranteedMinPoolSize: number;
  // Resolved brand + campaign exclusions, already unioned (US-14, ADR-0014).
  excludedCreatorIds: string[];
  // For top-up requests (ADR-0018), empty otherwise.
  alreadyOnShortlistCreatorIds: string[];
  // 150 ceiling per NFR-06.
  maxCandidates: number;
}

export interface GenerateShortlistEntry {
  creatorId: string;
  rank: number;
  fitScore: number;
  matchedAttributes: string[];
}

export interface GenerateShortlistReady {
  status: 'ready';
  entries: GenerateShortlistEntry[];
}

export interface GenerateShortlistNoViablePool {
  status: 'no_viable_pool';
}

export type GenerateShortlistResult =
  | GenerateShortlistReady
  | GenerateShortlistNoViablePool;

// Interface consumed from E3 (full shortlist/matching engine). E2 only defines
// the contract and ships a deterministic stub so quoting works end to end
// before E3's matching engine (FR-25) exists. Swapping to the real engine is
// a DI binding change only (see section 3.3.1 of the E2 architecture doc).
//
// generateShortlist is added by E3 (section 3.2.1 of the E3 architecture
// doc); estimatePool is unchanged, still consumed by E2's quote flow.
export interface MatchingEngineAdapter {
  estimatePool(input: EstimatePoolInput): Promise<EstimatePoolResult>;
  generateShortlist(input: GenerateShortlistInput): Promise<GenerateShortlistResult>;
}

export const MATCHING_ENGINE_ADAPTER = 'MATCHING_ENGINE_ADAPTER';

// Deterministic stub: filter-and-count-like heuristic driven by the
// narrowness of the targeting, plus a fixed price-per-creator-per-format
// table. No real creator network query exists yet in E2's scope.
@Injectable()
export class StubMatchingEngineAdapter implements MatchingEngineAdapter {
  private readonly PRICE_PER_CREATOR_PER_FORMAT = 350; // BRL, fixed stub rate

  async estimatePool(input: EstimatePoolInput): Promise<EstimatePoolResult> {
    const formats = input.deliverableFormats || [];
    const targeting = input.audienceTargeting || {};

    const narrownessScore = this.computeNarrownessScore(targeting);
    if (narrownessScore <= 0) {
      return { noViablePool: true };
    }

    const budget = parseFloat(input.budgetAmount) || 0;
    const formatCount = Math.max(formats.length, 1);
    const costPerCreator = this.PRICE_PER_CREATOR_PER_FORMAT * formatCount;

    const budgetCappedPoolSize = Math.max(
      1,
      Math.floor(budget / Math.max(costPerCreator, 1)),
    );
    const guaranteedMinPoolSize = Math.max(
      1,
      Math.min(budgetCappedPoolSize, narrownessScore),
    );

    const projectedReachLow = guaranteedMinPoolSize * 4000;
    const projectedReachHigh = guaranteedMinPoolSize * 7500;

    return {
      guaranteedMinPoolSize,
      projectedReachLow,
      projectedReachHigh,
      totalPrice: budget > 0 ? budget.toFixed(2) : (guaranteedMinPoolSize * costPerCreator).toFixed(2),
    };
  }

  // Stub retained for pre-E3 tests only; production traffic is bound to
  // RealMatchingEngineAdapter (matching module) once E3 ships. Never called
  // in that configuration, kept deterministic and honest (no_viable_pool)
  // rather than fabricating a fake shortlist.
  async generateShortlist(): Promise<GenerateShortlistResult> {
    return { status: 'no_viable_pool' };
  }

  // Narrower targeting (more geography/interest constraints, narrow age range)
  // yields a smaller addressable pool. This is a heuristic placeholder for
  // E3's real shortlist query.
  private computeNarrownessScore(targeting: AudienceTargeting): number {
    let score = 150; // pilot-scale ceiling, per NFR-06

    const geographyProvided = 'geography' in targeting;
    const interestsProvided = 'interests' in targeting;
    const geoCount = targeting.geography?.length || 0;
    const interestCount = targeting.interests?.length || 0;

    // An explicitly empty list for a provided dimension means zero addressable
    // creators on that dimension, distinct from the dimension not being used.
    if (geographyProvided && geoCount === 0) return 0;
    if (interestsProvided && interestCount === 0) return 0;

    if (geoCount > 0) {
      score = Math.min(score, geoCount * 40);
    }
    if (interestCount > 0) {
      score = Math.min(score, interestCount * 25);
    }
    if (targeting.age_range) {
      const [low, high] = targeting.age_range;
      const span = high - low;
      if (span <= 0) return 0;
      score = Math.min(score, span * 6);
    }

    return Math.max(score, 0);
  }
}
