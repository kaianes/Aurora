import { Injectable } from '@nestjs/common';

export type AudienceInsightsOutcome =
  | {
      outcome: 'success';
      audienceSize: number;
      demographicComposition: Record<string, number>;
      engagementRate: string;
      contentNiche: string;
    }
  | { outcome: 'rate_limited' }
  | { outcome: 'unreachable' }
  | { outcome: 'auth_revoked' };

// ADR-0051 (section 3.2 of the E8 architecture doc): account-level audience
// composition, keyed on (creatorId, socialAccountId, platform, accessToken)
// -- no contentSubmissionId, no dependency on any published content.
// Deliberately separate from E7's SocialMetricsAdapter (post-level,
// keyed on a single published piece of content) and from
// SocialAuthAdapter (token mechanics, not audience data).
export interface CreatorAudienceInsightsAdapter {
  getAudienceInsights(input: {
    creatorId: string;
    socialAccountId: string;
    platform: string;
    accessToken: string;
  }): Promise<AudienceInsightsOutcome>;
}

export const CREATOR_AUDIENCE_INSIGHTS_ADAPTER = 'CREATOR_AUDIENCE_INSIGHTS_ADAPTER';

const NICHES = [
  'beleza e skincare',
  'moda',
  'fitness',
  'gastronomia',
  'viagem',
  'tecnologia',
  'games',
  'maternidade',
];

// ADR-0051: this pilot's only implementation. Deterministically derives a
// synthetic, plausible audience-size/engagement/niche profile from
// creatorId and platform, always returning success -- the same
// "no real-world harm in synthetic-but-plausible numbers" reasoning
// StubSocialMetricsAdapter already established (ADR-0044). The three
// failure outcomes exist on the interface from day one, exercised only in
// integration tests against a mock adapter.
@Injectable()
export class StubCreatorAudienceInsightsAdapter implements CreatorAudienceInsightsAdapter {
  async getAudienceInsights(input: {
    creatorId: string;
    socialAccountId: string;
    platform: string;
    accessToken: string;
  }): Promise<AudienceInsightsOutcome> {
    const seed = this.seedFromId(`${input.creatorId}:${input.platform}`);

    const audienceSize = 300 + (seed % 20_000);
    const engagementRate = (0.3 + (seed % 60) / 10).toFixed(2);
    const contentNiche = NICHES[seed % NICHES.length];

    const youngShare = 0.2 + (seed % 30) / 100;
    const midShare = 0.4 + (seed % 20) / 100;
    const olderShare = Math.max(0, 1 - youngShare - midShare);
    const demographicComposition = {
      '18-24': Number(youngShare.toFixed(2)),
      '25-34': Number(midShare.toFixed(2)),
      '35+': Number(olderShare.toFixed(2)),
    };

    return {
      outcome: 'success',
      audienceSize,
      demographicComposition,
      engagementRate,
      contentNiche,
    };
  }

  private seedFromId(id: string): number {
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = (hash * 31 + id.charCodeAt(i)) % 1_000_003;
    }
    return Math.abs(hash);
  }
}
