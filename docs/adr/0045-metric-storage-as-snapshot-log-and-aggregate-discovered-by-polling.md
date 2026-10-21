# ADR-0045: Metric Data Modeled as Snapshot, Append-Only Log, and Pre-Computed Aggregate; Ingestion Discovers New Publications by Polling, Not a Hook Into E5's Transaction

**Status:** Proposed
**Date:** 2026-10-21
**Epic:** E7 -- Analytics and Reporting
**Governs:** US-21a, US-21b, FR-51, FR-52, NFR-02, NFR-08, NFR-35

## Context

Two related structural questions have to be answered before `SocialMetricsAdapter` (ADR-0044) has anywhere to write its results, and before the dashboard (US-21b) has anything fast to read: what shape does ingested metric data take once it lands in PostgreSQL, and how does this epic's code learn that a new piece of content exists to track at all.

**On shape.** `docs/architecture.md` already states a preference at the whole-platform level for exactly this situation: QAS-07 names "aggregates pre-computed by ingestion workers, not aggregated at read time" as the mechanism behind the dashboard's 3-second render budget, and T-05/N-05 name "PostgreSQL with materialized aggregates... snapshot tables isolated so extraction is contained later" and "serving metrics from stored snapshots rather than live" as an accepted, deliberate tradeoff (cost against read performance, resolved in favor of snapshots at pilot scale). This epic is the first to actually build the tables that make those statements concrete rather than aspirational.

**On discovery.** E6's `PayoutObligationService` (ADR-0036) is reached from inside E5's own publication-confirmation transaction, in the same database commit, because NFR-13's zero-tolerance integrity target leaves no room for a window in which a confirmed publication exists with no obligation yet created for it. This epic's situation is different in one load-bearing way: there is no analogous zero-tolerance requirement here. NFR-35 asks for graceful degradation, retries, and visible staleness -- the explicit opposite of a strict, same-transaction guarantee. A missing or delayed metric snapshot is never a lost financial obligation; at worst it is a dashboard that has not yet picked up a creator's newest post, which NFR-35 already anticipates and names acceptable ("serves last-known metrics marked as stale").

Two options were considered for discovery, mirroring the same two options ADR-0036 weighed for a different epic's different constraint:

- **Extend E5's publication-confirmation transaction** with an additional, in-process call into this epic's exported service, the exact mechanism ADR-0032 and ADR-0036 already used twice. This would guarantee a snapshot row exists the instant a publication is confirmed, at the cost of making `content-workflow`'s `PublicationService` depend on yet another module (`analytics`, after `payments`) for a guarantee this epic does not actually need as strongly as E6 needed its own.
- **Discover new work by scheduled polling** against `content_submission.published_at`, the field E5 already exposes and already treats as a stable, queryable fact (it is indexed and read by multiple consumers already, including E6's own trigger point). This adds no dependency to `content-workflow` at all; E7 reads E5's table, E5 never calls into E7.

## Decision

**Shape.** Ingested metric data is modeled as three tables (section 2 of the architecture document), not one:

1. **`content_submission_metric_snapshot`** -- one row per published `content_submission`, holding the *current, best-known* reach/engagement/impressions and a staleness/failure classification. This is the only metrics table the dashboard, the report, and US-37's endpoint ever read.
2. **`performance_metric_ingestion_attempt`** -- an append-only log of every pull attempt, success or failure, the literal unit NFR-08's volume target counts. Never read by any user-facing endpoint; it exists for the same reason `audit_log` and `payout_execution_attempt` exist, as a historical trail for operators and for volume monitoring (NFR-31).
3. **`campaign_performance_aggregate`** -- one pre-computed row per campaign, recomputed inline whenever ingestion or a newly discovered publication touches that campaign's creators, never computed at dashboard-request time.

Splitting "current state" from "history of attempts" from "campaign-level rollup" means each of the three can be optimized for its one actual read pattern (a point lookup, an append-only write, and a single-row read respectively) without any of the three becoming a performance or correctness compromise for the others' sake.

**Discovery.** `discover-and-ingest-metrics` (ADR-0044) discovers work by querying `content_submission` for rows with `published_at IS NOT NULL` and no corresponding `content_submission_metric_snapshot` row yet -- a plain, indexed, outer-join query, run every cycle. `content-workflow.module.ts` is **not** modified by this epic; `PublicationService.confirmPublication` gains no new call, unlike the wiring ADR-0036 required of it for E6. The worst case of this choice is that a newly published piece of content waits up to one 4-hour cycle before its snapshot row is created and its first pull attempted -- a bounded, visible delay (the dashboard shows it as `pending_delivery` or, once discovered, `pending_first_pull`, never a fabricated zero), well within what NFR-35 already tolerates and far short of anything NFR-13 would have forbidden had it applied here.

## Consequences

**What Aurora gains:**
- `content-workflow`'s dependency surface does not grow a third time (after `brand-safety` and `payments`) for a guarantee this epic does not need as strongly as the module that already asked for it. E5's publication-confirmation endpoint stays exactly as fast and exactly as simple as E6 already left it.
- The three-table split gives the dashboard its 3-second budget "for free," in the sense that no read-time aggregation step exists to slow down as history grows -- NFR-02's 6-month history clause is satisfied by never touching the one table (`performance_metric_ingestion_attempt`) whose size actually grows with history length.
- The pattern is consistent with `docs/architecture.md`'s own stated tradeoff (T-05/N-05): this epic does not introduce a dedicated analytical datastore, it uses PostgreSQL with materialized aggregates exactly as the top-level architecture document already committed to doing "for now."

**What Aurora gives up:**
- A up-to-4-hour discovery delay between a publication being confirmed and its metrics snapshot existing at all, which a same-transaction hook would have eliminated. This is an accepted cost given the absence of a zero-tolerance requirement on this epic's data, not an oversight.
- Three tables to reason about instead of one, which is a small amount of additional schema surface for a human reader to hold in mind. This mirrors the identical, already-accepted tradeoff E6 made for `payout_obligation` vs. `ledger_entry` vs. `payout_execution_attempt` -- separating "current state," "what actually happened," and "the record other things read" is a repeated, deliberate pattern in this codebase, not a one-off complexity.

**Risk:** If a future epic (or a later revision of this one) ever needs a stricter, same-transaction guarantee for metrics -- for example, if a creator's own media kit (FR-14, E8) comes to depend on a metric figure being present the instant a publication is confirmed -- this polling-based discovery would need to be revisited in favor of the hook pattern ADR-0036 already established. No schema change would be required to make that switch (the three tables would be unchanged), only a new call site in `content-workflow`, the same low-cost migration path ADR-0036 itself already describes for its own wiring.
