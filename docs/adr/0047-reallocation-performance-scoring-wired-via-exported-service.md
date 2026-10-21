# ADR-0047: E2's `reallocate-budget` Job Fed via an Exported `PerformanceScoringService`, Replacing the Hardcoded `metricsFeedAvailable: false` Stub

**Status:** Proposed
**Date:** 2026-10-21
**Epic:** E7 -- Analytics and Reporting
**Governs:** US-21a, US-10 (E2), FR-23, FR-52, NFR-29, NFR-35

## Context

E2's `CampaignScheduledTasksService.scheduleReallocation` (`backend/src/campaign/campaign-scheduled-tasks.service.ts`) already enqueues a `reallocate-budget` job every 6 hours for every campaign with reallocation enabled -- and today it does so with the literal values `metricsFeedAvailable: false, performance: []`, with a comment stating plainly that "the metrics feed integration (FR-52) does not exist yet in E2's scope... the job correctly skips and logs rather than acting on absent data." `ReallocationProcessor.handleReallocateBudget` (`backend/src/campaign/reallocation.processor.ts`) already consumes exactly the shape this epic needs to produce -- `{ metricsFeedAvailable: boolean, performance: PerformanceSample[] }` where `PerformanceSample = { poolMemberId: string, score: number }`, with `score` read as "a normalized performance score, higher is better" and the processor itself computing each member's relative performance against the pool average.

This is not a conceptual, planned-for-later hand-off the way `MatchingEngineAdapter.estimatePool` was for E3 before E3 shipped -- it is live, already-tested, currently-stubbed production code, waiting on exactly this epic to stop stubbing it. The question this ADR resolves is mechanical, the same kind of question ADR-0036 resolved for E6's hand-off into E5: *how* does this epic's code actually run before `scheduleReallocation` enqueues each job, given that this codebase has no event bus and every real cross-module hand-off is a direct, in-process service call (ADR-0032, ADR-0036).

Three sub-questions had to be answered together:

1. **Mechanism.** Does `campaign-scheduled-tasks.service.ts` call into this epic directly, or does this epic somehow feed E2's queue itself? A direct call is the only option consistent with every prior cross-module hand-off in this codebase.
2. **What counts as `metricsFeedAvailable = false`?** The processor expects one boolean per campaign per cycle, covering the whole campaign, not a per-member partial signal (the processor's own existing logic already handles "no data for this one member" gracefully by omitting that member from `performance`, matching US-10 scenario 2's "never penalized for lacking data" -- that part of the design is already correct and untouched). So this epic's service has to decide, campaign-wide, whether the feed is usable this cycle at all.
3. **What is `score`?** The processor treats it as an opaque, comparable number; nothing requires it to match the buyer-facing cost-efficiency figure (ADR-0046), and reusing that figure directly would be a mistake, since ADR-0046's figure is a single, absolute, campaign-level number meant for a human reading a report, not a per-creator, pool-relative figure meant to drive an algorithm.

## Decision

`campaign.module.ts` imports the new `AnalyticsModule`, and `CampaignScheduledTasksService`'s constructor gains a dependency on this epic's exported `PerformanceScoringService` -- the identical wiring shape ADR-0032 and ADR-0036 already used twice (a `module.ts` import plus a constructor injection, nothing else). `scheduleReallocation`'s loop replaces its hardcoded literals with a call to this one exported method:

```typescript
// Exported by AnalyticsModule. The only caller in the codebase is
// CampaignScheduledTasksService.scheduleReallocation, immediately before
// it enqueues each reallocate-budget job.
interface PerformanceScoringService {
  getReallocationInputs(campaignId: string): Promise<{
    metricsFeedAvailable: boolean;
    performance: Array<{ poolMemberId: string; score: number }>;
  }>;
}
```

**`metricsFeedAvailable`** is `true` if and only if at least one of the campaign's `campaign_pool_member` rows, mapped through the delivery join path (section 3.3 of the E7 architecture document) to a `content_submission_metric_snapshot`, has `ingestion_status = 'fresh'`. It is `false` only when **zero** pool members have any current, non-stale data at all -- not when some members are stale and others are fresh. This reading is deliberately less strict than "every member must be fresh": NFR-35 itself frames graceful degradation as *partial*, not all-or-nothing ("serves last-known metrics marked as stale" implies some members can be stale while the system keeps functioning for the rest), and a stricter "any one stale member blocks the whole campaign's reallocation" rule was considered and rejected as inconsistent with that framing -- it would let one creator's revoked token (ADR-0044) freeze budget optimization for 149 other, perfectly healthy creators.

**`performance`** includes exactly the pool members whose delivery join path resolves to a `content_submission_metric_snapshot` with `ingestion_status = 'fresh'`; every other member (not yet delivered, delivered but not yet pulled, or currently stale) is simply absent from the array -- which `ReallocationProcessor`'s existing, unmodified code already treats correctly as "no data, leave untouched" (section 2.2 of the E2 architecture document, US-10 scenario 2). `score` is each member's creator's current `engagement` figure from her `content_submission_metric_snapshot` row (summed across pieces if a creator has more than one published deliverable in the campaign) -- a relative, pool-internal figure, computed independently of, and never equal to, ADR-0046's buyer-facing `cost_per_engagement`/`cpm_equivalent`. Both are derived from the same underlying snapshot data; neither is stored twice, and neither module reads the other's computed output.

`reallocation.processor.ts` is **not modified at all** by this epic -- the shape it already expects is exactly the shape this epic now produces, which is the entire point of E2 having defined that interface shape in advance of this epic shipping.

## Consequences

**What Aurora gains:**
- E2's existing, already-tested reallocation algorithm starts acting on real (pilot-synthetic, per ADR-0044) performance data with zero changes to `reallocation.processor.ts`, `reallocation.processor.spec.ts`, or any of E2's own reallocation-bounds logic (ADR-0007) -- the exact decoupling NFR-29 already names as a design goal for replaceable, model-driven components, now demonstrated a second time (after `MatchingEngineAdapter`'s swap from stub to real) for a different module pair.
- The wiring change is the third instance of the same, well-rehearsed pattern (`campaign.module.ts` importing `AnalyticsModule`, mirroring `content-workflow.module.ts` importing `PaymentsModule` per ADR-0036 and `brand-safety.module.ts`'s export per ADR-0032), so the engineering risk of the integration itself is low.
- The campaign-wide (not per-member) `metricsFeedAvailable` reading keeps a single stale or revoked creator from freezing reallocation for an entire healthy pool, consistent with NFR-35's explicit framing of degradation as partial rather than total.

**What Aurora gives up:**
- `CampaignScheduledTasksService` now depends on one more module (`analytics`), growing E2's dependency surface for the second time in this document's history (the first being its original, still-stubbed dependency on a matching/metrics feed by design). This is the same, already-accepted cost ADR-0032/ADR-0036 named for their own wiring changes, bounded the same way: the dependency is on one narrow, stable method, not on `analytics`'s internals.
- The reallocation score (raw engagement) and the report's cost-efficiency figure (ADR-0046) are deliberately different calculations over the same underlying data -- a reader comparing the two without reading both ADRs could reasonably wonder why they disagree. Mitigation: both ADRs cross-reference each other and state explicitly that they answer different questions for different audiences.

**Risk:** `score = raw engagement` rewards creators with larger audiences regardless of efficiency, which could systematically shift budget toward already-large creators rather than toward creators who convert best per unit of spend -- arguably in tension with the business analysis's own thesis that nano and micro creators convert better *per reais spent*, not in absolute engagement terms. Mitigation: this is recorded as an open architectural default (same category as ADR-0046's own formula risk), not a resolved product decision; `PerformanceScoringService.getReallocationInputs`'s scoring logic is isolated in one method, so revising it to an efficiency-normalized score (e.g., engagement per reais of `allocated_budget`) later is a change inside this epic's own service, with no change required to `reallocation.processor.ts` or to this method's own interface shape.
