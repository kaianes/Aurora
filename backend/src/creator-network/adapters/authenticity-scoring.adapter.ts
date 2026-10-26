import { Injectable } from '@nestjs/common';

export type AuthenticityScoringOutcome =
  | { outcome: 'scored'; score: number } // 0-100
  | { outcome: 'insufficient_data' };

// ADR-0052 (section 3.3 of the E8 architecture doc): fraud/anomaly
// detection, called by compute-creator-metrics immediately after
// CreatorAudienceInsightsAdapter succeeds, using its output as input
// signals. Deliberately its own adapter, not folded into the audience
// adapter -- a real implementation is plausible as a specialized
// third-party fraud-detection vendor, not the same platform API call that
// returns audience demographics.
export interface AuthenticityScoringAdapter {
  scoreAuthenticity(input: {
    creatorId: string;
    socialAccountId: string;
    audienceSize: number;
    engagementRate: string;
  }): Promise<AuthenticityScoringOutcome>;
}

export const AUTHENTICITY_SCORING_ADAPTER = 'AUTHENTICITY_SCORING_ADAPTER';

// ADR-0052: this pilot's only implementation. Always returns scored with a
// deterministic, synthetic value in normal pilot operation -- consistent
// with every other stub in this codebase defaulting to the success path.
// insufficient_data is exercised only in integration tests against a mock.
@Injectable()
export class StubAuthenticityScoringAdapter implements AuthenticityScoringAdapter {
  async scoreAuthenticity(input: {
    creatorId: string;
    socialAccountId: string;
    audienceSize: number;
    engagementRate: string;
  }): Promise<AuthenticityScoringOutcome> {
    const seed = this.seedFromId(input.creatorId);
    const score = 35 + (seed % 65); // 35-99
    return { outcome: 'scored', score };
  }

  private seedFromId(id: string): number {
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = (hash * 31 + id.charCodeAt(i)) % 1_000_003;
    }
    return Math.abs(hash);
  }
}
