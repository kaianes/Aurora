# ADR-0057: Media Kit Reuses E7's Performance Data via an Exported Service, Never Recomputing or Duplicating It

**Status:** Proposed
**Date:** 2026-10-21
**Epic:** E8 -- Creator Recruitment and Growth
**Governs:** US-25, FR-14

## Context

FR-14 requires Aurora to "generate a media kit for a creator from their real campaign history and audience metrics, exportable as a shareable document." The stories document's own "Related epic dependency" note is explicit that this story "draws on campaign performance data that is E7's scope to produce (FR-54, US-37)... Does not duplicate E7's creator-performance dashboard; the media kit is an export artifact, not a new reporting surface." E7 already built and owns exactly the data this story needs for its campaign-history section: `content_submission_metric_snapshot` (per-published-piece reach/engagement/impressions, E7 architecture doc section 2.2), already surfaced to a creator herself via `GET /creator-portal/performance` (E7 architecture doc section 5.4), scoped to her own `creator_id` from her JWT exactly as this epic's media-kit endpoint would need to scope it.

The question is mechanical, the same kind of question ADR-0032, ADR-0036, and ADR-0047 each already resolved for their own cross-module hand-off: does `creator-network` read `analytics`'s tables directly, or does it call into `analytics` through an exported, narrow interface?

Two options were considered:

- **`creator-network` queries `content_submission_metric_snapshot` and the delivery join path directly**, duplicating the join logic E7's `GET /creator-portal/performance` endpoint already implements (`campaign_pool_member` -> `campaign_opportunity` -> `content_submission` filtered to `published_at IS NOT NULL`, per E7 architecture doc section 3.3). Rejected: this is the exact anti-pattern E6 and E7 both explicitly avoided with each other's data ("this epic's own data model never re-derives a figure another epic already owns the computation for," E7 architecture doc section 1) -- a second implementation of the same join logic is a second place a future change to E5's submission model or E3's opportunity model would need to be reflected, with no guarantee the two stay in sync.
- **`creator-network` calls a new, narrow method `analytics.module.ts` exports**, following the exact wiring shape ADR-0032/ADR-0036/ADR-0047 already made routine: a `module.ts` import plus a constructor injection, nothing else.

## Decision

`analytics.module.ts` exports one new method, additive to its existing public surface:

```typescript
interface AnalyticsService {
  getCreatorDeliveredPerformance(creatorId: string): Promise<
    Array<{
      campaignId: string;
      campaignName: string;
      publishedUrl: string;
      publishedAt: Date;
      reach: number | null;
      engagement: number | null;
      impressions: number | null;
      ingestionStatus: string;
    }>
  >;
}
```

This returns exactly the same rows and the same join path `GET /creator-portal/performance` already computes (E7 architecture doc section 5.4) -- it is, in effect, that endpoint's existing query logic extracted into a reusable, in-process method rather than reimplemented a second time. `creator-network.module.ts` imports `AnalyticsModule` and injects this service into `generate-media-kit`'s processor. If the returned array is empty, `creator_media_kit_export.has_campaign_history = false` (US-25 scenario 2); `analytics` itself is never asked to produce a yes/no "has she delivered anything" answer directly, since an empty array already is that answer without a second method.

`creator-network` never reads `content_submission_metric_snapshot`, `campaign_pool_member`, `campaign_opportunity`, or any other E2/E3/E5/E7-owned table directly. The only data this epic's own code queries for the media kit, beyond this one exported call, is `creator`'s own audience-metrics columns (`audience_size`, `demographic_composition`, `engagement_rate`, `content_niche`, `authenticity_score`) -- data this epic itself owns and computed.

## Consequences

**What Aurora gains:**
- The media kit's campaign-history section can never drift from what `GET /creator-portal/performance` itself shows her, because both read the identical method -- a creator comparing her media kit to her own performance dashboard will never find the two disagreeing about what she delivered.
- This is the fourth instance of the identical exported-service wiring pattern in this codebase (after ADR-0032, ADR-0036, ADR-0047), making it a well-rehearsed, low-risk integration rather than a novel one -- the engineering risk of this specific wiring change is low precisely because the pattern has already been exercised three times.
- `analytics.module.ts`'s internal tables and their RLS/creator-portal-branch policies (E7 architecture doc section 2.5) are untouched -- this epic adds a method, not a new table, a new policy, or a new escape hatch.

**What Aurora gives up:**
- `creator-network` now depends on `analytics`, growing that module's list of dependents (previously only `campaign`, per ADR-0047) -- a modest, accepted coupling cost, bounded the same way every other instance of this pattern is bounded: the dependency is on one narrow, stable method's return shape, not on `analytics`'s internals.
- If `analytics`'s underlying delivery-join logic changes shape in a future epic, this epic's media kit inherits that change automatically (which is the intended benefit) but also inherits any bug in it automatically (a shared cost of not duplicating the logic) -- accepted, since the alternative (duplicating) trades a shared-bug risk for a guaranteed-divergence risk, which this codebase's own precedent already judges the worse trade.

**Risk:** None specific to this decision beyond the general coordination cost every cross-module exported-service call in this codebase already carries and already accepts (ADR-0032, ADR-0036, ADR-0047's own "Consequences" sections each name the identical tradeoff for their own hand-off).
