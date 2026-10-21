import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ContentSubmission } from '../../database/entities';

export type MetricsPullOutcome =
  | { outcome: 'success'; reach: number; engagement: number; impressions: number }
  | { outcome: 'rate_limited' }
  | { outcome: 'unreachable' }
  | { outcome: 'auth_revoked' };

export interface SocialMetricsPullInput {
  creatorId: string;
  contentSubmissionId: string;
  platform: string;
  publishedUrl: string;
}

// ADR-0044: the only internal abstraction the ingestion pipeline depends on.
// Consumed by exactly one thing: discover-and-ingest-metrics (section 4.2 of
// the E7 architecture doc) -- no controller, no other module, calls it
// directly.
export interface SocialMetricsAdapter {
  pullMetrics(input: SocialMetricsPullInput): Promise<MetricsPullOutcome>;
}

export const SOCIAL_METRICS_ADAPTER = 'SOCIAL_METRICS_ADAPTER';

// ADR-0044: this pilot ships exactly this one implementation. It makes no
// network call to any social platform, sandbox or otherwise, and always
// returns { outcome: 'success' } -- unlike StubPayoutExecutionAdapter, which
// deliberately never auto-succeeds, there is no real-world harm in a demo
// dashboard showing synthetic-but-plausible numbers.
//
// The adapter's own interface carries only creatorId/contentSubmissionId/
// platform/publishedUrl (the exact shape ADR-0044 specifies, unchanged), but
// the deterministic growth curve this stub derives needs the elapsed time
// since the submission was published -- data the interface does not pass
// through. Rather than widening the interface (which would deviate from the
// architecture document's own exact contract), this implementation detail
// stays entirely inside the stub: it reads content_submission.publishedAt
// itself, the same "an adapter implementation is free to reach into
// whatever it needs beyond its own input, as long as its contract stays
// unchanged" discipline RealMatchingEngineAdapter already established for a
// different adapter pair.
@Injectable()
export class StubSocialMetricsAdapter implements SocialMetricsAdapter {
  constructor(
    @InjectRepository(ContentSubmission)
    private submissionRepo: Repository<ContentSubmission>,
  ) {}

  async pullMetrics(input: SocialMetricsPullInput): Promise<MetricsPullOutcome> {
    const submission = await this.submissionRepo.findOne({
      where: { id: input.contentSubmissionId },
    });
    const publishedAt = submission?.publishedAt ? submission.publishedAt.getTime() : Date.now();
    const elapsedHours = Math.max(0, (Date.now() - publishedAt) / (1000 * 60 * 60));

    // A small, deterministic seed derived from the submission id so two
    // different pieces of content never produce identical figures, but the
    // same piece always grows along the same curve on every pull.
    const seed = this.seedFromId(input.contentSubmissionId);

    const reach = Math.round((seed % 500) * 20 + elapsedHours * (10 + (seed % 7)));
    const engagement = Math.round(reach * (0.03 + (seed % 5) / 100));
    const impressions = Math.round(reach * (1.4 + (seed % 3) / 10));

    return { outcome: 'success', reach, engagement, impressions };
  }

  private seedFromId(id: string): number {
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = (hash * 31 + id.charCodeAt(i)) % 1_000_003;
    }
    return Math.abs(hash);
  }
}
