# ADR-0044: Performance Metrics Ingestion Isolated Behind a `SocialMetricsAdapter`, With Only a Stub Implementation and a Fixed 4-Hour Cadence in This Pilot

**Status:** Proposed
**Date:** 2026-10-21
**Epic:** E7 -- Analytics and Reporting
**Governs:** US-21a, FR-52, NFR-08, NFR-35

## Context

FR-52 requires Aurora to "ingest performance metrics from connected social platforms throughout a live campaign." `docs/architecture.md` already commits, at the whole-platform level, to an inference/fetch adapter boundary for exactly this category of external dependency (section 2.1: "An inference adapter isolates matching and brand safety behind an internal port, never a provider SDK directly"), and E3, E4, and E6 have each already executed the equivalent decision for their own external dependency -- `MatchingEngineAdapter` (ADR-0011), `ContentSafetyAdapter` (ADR-0021), and `PayoutExecutionAdapter` (ADR-0033). This is this epic's version of the same decision, made concrete for social-platform metrics.

Two structural facts make this decision time-sensitive and shape it:

1. **No real OAuth token exists anywhere in the codebase to pull against.** FR-08 (linking a creator's social account through the platform's own authorization flow, so Aurora never holds credentials) is E8's scope, and E8 has not shipped. The stories document's own integration note states this plainly: "Ingestion depends on a creator having a linked social account with a valid authorization token (FR-08, E8) -- a dependency this epic assumes exists but does not itself build." A real adapter implementation calling Instagram's or TikTok's API today would have no live token to use, in any environment, for any creator.
2. **The PRD states no ingestion cadence or per-creator latency target** (its own open question 4), only a platform-wide daily volume ceiling (NFR-08, 20,000 events/day). A cadence has to be chosen to make the volume target concrete and testable at all.

Two structural options were considered for where the adapter boundary sits, and two for cadence:

- **Build the real platform integrations now**, gated behind per-platform feature flags that stay off until E8 ships real tokens. Rejected for the same reason ADR-0033 rejected it for payments: it puts a live, external, third-party dependency and its credential/rate-limit/error-taxonomy surface into the pilot's dependency graph before anything downstream (the dashboard, the report, the reallocation score) has been validated against something predictable, and there is no token to actually exercise it with yet regardless.
- **Define the adapter interface now, ship a deterministic stub, and build real platform implementations later**, one per platform, each a new class and a DI binding change. This defers the highest-variance, least-controllable part of this epic until the rest of it (the snapshot model, the aggregate, the dashboard, the report, the reallocation hand-off) has been built and exercised against something the team fully controls.
- **Cadence:** either a continuous, per-submission polling loop with per-platform backoff state machines, or a single fixed-interval scheduled sweep across every published submission, mirroring every other scheduled job already in this codebase (`reallocate-budget`, `escalate-overdue-draft-reviews`, `poll-in-flight-payouts`). The latter is simpler, bounded, and auditable by construction (one row per attempt, section 2.2 of the architecture document), at the cost of being slightly less responsive than a continuous loop.

## Decision

E7 defines `SocialMetricsAdapter`, exported by the new `analytics` module and consumed by exactly one thing: the `discover-and-ingest-metrics` job processor (section 4 of the E7 architecture document).

```typescript
export type MetricsPullOutcome =
  | { outcome: 'success'; reach: number; engagement: number; impressions: number }
  | { outcome: 'rate_limited' }
  | { outcome: 'unreachable' }
  | { outcome: 'auth_revoked' };

export interface SocialMetricsAdapter {
  pullMetrics(input: {
    creatorId: string;
    contentSubmissionId: string;
    platform: string;
    publishedUrl: string;
  }): Promise<MetricsPullOutcome>;
}
```

**This pilot ships exactly one implementation: `StubSocialMetricsAdapter`.** It makes no network call to any social platform, sandbox or otherwise. It deterministically derives a synthetic, monotonically-growing reach/engagement/impressions triple from `contentSubmissionId` and the elapsed time since the submission's `publishedAt`, and always returns `{ outcome: 'success' }` -- unlike `StubPayoutExecutionAdapter` (ADR-0033), which deliberately never auto-succeeds because the stakes of a false "money moved" signal are categorically different from a false "this post has 18,400 views" signal. There is no real-world harm in a demo dashboard showing synthetic-but-plausible numbers; there would be real harm in a demo pretending a payment happened. The three failure branches (`rate_limited`, `unreachable`, `auth_revoked`) exist on the interface from day one and are exercised in integration tests against a mock adapter, never against the stub itself, so US-21a's scenarios 2 and 3 are testable without needing the stub to behave unpredictably.

**Ingestion runs on a fixed cadence of every 4 hours**, a `discover-and-ingest-metrics` cron job, chosen as an architectural default against NFR-08's 20,000-events/day ceiling (the arithmetic is in section 1 of the architecture document) and consistent with every other scheduled job this codebase already runs on a fixed interval rather than a continuous loop. A real platform implementation, when built, can keep this cadence or tighten it per platform without any change to `content_submission_metric_snapshot`'s shape, `performance_metric_ingestion_attempt`'s shape, or any code outside the adapter and its DI binding -- the same NFR-29-style modifiability guarantee E3's matching adapter and E4's safety adapter already provide for their own domains, now extended to a fourth: the metrics-ingestion adapter is the one piece of code that knows how a real pull happens, or how often it is safe to attempt one against a given platform's rate limits.

## Consequences

**What Aurora gains:**
- Zero dependency on a credential or token that cannot exist yet (E8 has not shipped FR-08), and zero live third-party API behavior to reason about during this epic's own security and reliability review.
- The harder, genuinely this-epic's-own problems -- the snapshot/log/aggregate data model, the staleness and failure-type distinction, the dashboard's pre-computed-read discipline, the reallocation hand-off -- are built and exercised against a predictable, fully-controlled stub, the same sequencing benefit ADR-0033 already banked for the payment path.
- The swap to a real per-platform adapter is isolated to one new class per platform and one DI binding, a well-rehearsed pattern in this codebase by this point (the fourth adapter built this way, after `MatchingEngineAdapter`, `ContentSafetyAdapter`, and `PayoutExecutionAdapter`).

**What Aurora gives up:**
- A real demonstration of "Aurora shows you what is actually happening on Instagram right now" is not possible with this adapter alone -- the dashboard and report are honestly fed by synthetic data until a real adapter and a real, claimed creator social account both exist. This is the identical honesty tradeoff ADR-0033 already named for payouts, applied here to a lower-stakes domain.
- The 4-hour cadence is an assumption, not a validated requirement -- if product later states a tighter per-creator freshness expectation than NFR-08's aggregate volume target implies, the cadence (and the volume arithmetic in section 1 of the architecture document) will need revisiting. This is the same category of risk `docs/architecture.md`'s R-01 already names for an unmeasured assumption behind a cost/volume claim.

**Risk:** Once a real adapter is built, nothing in this design gives a creator a way to signal "I reconnected my account" that clears a `stale_auth_revoked` snapshot faster than the 24-hour backoff window (section 4.2 of the architecture document) -- because the reconnection flow itself is E8's scope, not yet built. Mitigation: this is recorded explicitly as an open item (section 9 of the architecture document) rather than solved with an invented mechanism; a real E8 implementation is the natural point to also clear this epic's staleness flag on a successful reconnection, and this adapter's narrow interface does not need to change to support that.
