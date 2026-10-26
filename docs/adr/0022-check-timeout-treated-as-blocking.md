# ADR-0022: A Safety Check That Cannot Complete Blocks Publication Exactly Like a Flag, After a 10-Minute Hard Timeout

**Status:** Proposed
**Date:** 2026-10-20
**Epic:** E4 -- Brand Safety
**Governs:** US-16, FR-33, NFR-03

## Context

PRD open question 3 (`docs/epics/e4-brand-safety/stories.md`) states the gap: FR-33 refuses publication when content "has not passed" the safety check, and NFR-03 sets a 5-minute p95 target for a verdict, but neither says what happens when the check cannot complete at all -- the engine is down, a dependency times out, or the job otherwise never resolves. The stories document's own acceptance criteria already lean toward one answer ("the acceptance criteria above treat 'pending/no verdict' the same as 'flagged' for the purpose of blocking publication, since that is the only reading consistent with FR-33's zero-tolerance framing") but flag it as needing confirmation, not as settled.

This ADR makes that decision explicit and gives it a concrete mechanism, because without one, a stuck check has no defined exit: it could sit `pending` forever (silently never blocking anyone from attempting to publish, since nothing ever says "no"), or a careless implementation could default an unresolved check to a pass (directly violating FR-33's "has not passed" framing, since an engine that never ran is certainly not a content submission that passed).

Three options were considered:

- **Leave it pending indefinitely, with no timeout.** The simplest to implement, but it means a single stuck check can block a creator's content forever with no path to resolution and no signal to anyone that something is wrong. This also makes NFR-03's p95 target unmeasurable in practice, since a check that never resolves never contributes a latency sample at all -- it would disappear from the metric rather than showing up as a miss.
- **Default to pass after a timeout.** Rejected outright by FR-33's own wording: "refuses any attempt to mark content as published when that content has not passed the brand safety check." A timed-out check has not passed; it has not been evaluated. Defaulting to pass here is the exact zero-tolerance failure FR-33 exists to prevent, and it would mean an engine outage silently waives brand safety for every submission that happens to arrive during it -- the worst possible failure mode for a safety-critical gate.
- **Timeout to a distinct, publication-blocking state, routed to the same human review queue a flag would use.** A stuck check gets a bounded amount of time, after which it is marked as unable to complete, blocks publication exactly as a flag would, and is handed to a human -- because an automated check that cannot run is not a judgment a human should be denied the chance to make manually.

## Decision

A `safety_check` row is given `timeout_at = requested_at + 10 minutes` at creation. A scheduled sweeper (`expire-pending-checks`, every 2 minutes) finds any check still `status = 'pending'` past its `timeout_at` and transitions it to `status = 'check_unavailable'`. This status:

- **Blocks publication identically to `flagged`.** The gate computation in section 2.8 of the E4 architecture document treats `check_unavailable` and `flagged` as the same blocking posture unless and until a human clears it -- there is no code path in which `check_unavailable` resolves to "cleared" on its own.
- **Routes to the same human review queue as a flag**, with `reason_category = 'check_unavailable'` so the queue entry honestly states "the check could not complete," never implying a rule was triggered when none was evaluated. A single `safety_rule_trigger` row with `channel = 'system'` and `rule_id = null` is written so the review queue's UI has something concrete to display without inventing a fake rule citation.
- **Is clearable by a human decision**, exactly like a flag: Marina (or whichever role is authorized, per section 2.4's note on open question 5) can review the content manually and approve it, which is the same override mechanism a flagged item uses. The engine's failure to produce a verdict never becomes a permanent block with no path forward, but the path forward is always a human looking at the actual content, never an automatic retry that silently flips the gate.

The 10-minute threshold is chosen deliberately **above** the 5-minute p95 target in NFR-03, not at or below it. NFR-03's target is a 95th-percentile figure, which by definition tolerates some checks running past 5 minutes without breaching the requirement -- if the hard timeout fired at exactly 5 minutes, the timeout mechanism itself would start converting NFR-03's already-budgeted slow tail into `check_unavailable` states, inflating the number of human-review escalations for checks that were simply slow, not actually stuck. Ten minutes gives real headroom for a slow-but-eventually-successful check to still resolve normally, while still bounding the worst case to something an operator can reasonably be expected to notice and investigate.

## Consequences

**What Aurora gains:**
- FR-33's zero-tolerance framing holds without exception: there is no state a submission can be in -- passed, flagged, pending, or stuck -- that defaults to publishable. "Has not passed" covers every one of these except the one explicit pass state.
- A stuck check has a bounded, defined lifecycle: it does not sit invisible forever, and it does not silently resolve itself in either direction. An operator or Marina always ends up with something actionable in the review queue.
- The same queue, the same decision endpoint, and the same role permissions (section 2.4) serve both flagged and check-unavailable items, so this decision adds no new surface for backend-dev or frontend-dev to build beyond the `reason_category` distinction already needed for US-17's own requirement to be honest about why an item is in the queue.
- NFR-03's p95 metric stays meaningful: a check that times out still produces a `resolved_at` (when the sweeper acts), so it contributes a (very slow) latency sample rather than disappearing from the measurement, keeping the production signal honest about how often this actually happens.

**What Aurora gives up:**
- Every engine outage or sustained degradation now generates review-queue volume at the rate of however many submissions arrive during the outage, each waiting up to 10 minutes before escalating. At pilot scale (NFR-06's 150-creator ceiling) this is a manageable, visible backlog; it would need revisiting (e.g., a faster bulk-escalation path, or an operational alert distinct from the per-item queue entry) if sustained outages became frequent at larger scale.
- The 10-minute number is a judgment call, not a value derived from measured latency data (none exists yet pre-launch). It is recorded here as the pilot default and should be revisited once real latency distributions exist, the same caveat `docs/architecture.md` already attaches to the escalation-rate assumption behind the cascade's cost claims (risk R-01).

**Risk:** If tier-2 escalation (ADR-0021) turns out to be systematically slower than the cascade's cost model assumes, 10 minutes could prove too tight for a meaningful fraction of legitimately-still-running checks, inflating `check_unavailable` volume for reasons unrelated to an actual outage. Mitigation: the threshold lives in configuration (not a schema field, not hardcoded inline), so it can be tuned without a migration, consistent with NFR-29's broader posture on this epic's design.
