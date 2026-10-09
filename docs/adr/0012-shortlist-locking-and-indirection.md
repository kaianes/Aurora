# ADR-0012: Shortlist State Lives Behind `campaign_pool_member`, Never Read Directly by Campaign or Payment Code

**Status:** Proposed
**Date:** 2026-10-05
**Epic:** E3 -- Creator Matching and Curation
**Governs:** US-11, US-13, US-40, NFR-29

## Context

NFR-29 requires the matching model to be replaceable "without disturbing the money path," explicitly meaning no changes to campaign or payment code and no database migration. E3 introduces a genuinely complex piece of state -- `campaign_shortlist` and `campaign_shortlist_entry`, with ranks, scores, origins, decisions, and a lock flag -- that did not exist when E2 was built. E2's `campaign_pool_member` table (the thing `campaign` and, downstream, E6's payment code actually read) was deliberately left empty of any matching logic; it only holds the allocation once a pool exists. The question this ADR settles is how the two connect without re-coupling what E2 took care to decouple.

Two designs were considered:

- **Let `campaign` read `campaign_shortlist_entry` directly** when a campaign activates, computing the pool from shortlist state at that moment. This is less code today, but it means `campaign`'s activation logic has to understand shortlist semantics (`included`, `decision`, `origin`, `locked`) forever, and any future change to shortlist's internal shape (e.g., a new origin type, a new decision state) risks a change in `campaign`'s code too -- exactly what NFR-29 rules out.
- **Keep the hand-off one-directional and append-only: when a shortlist locks, E3 writes the final creator list into `campaign_pool_member` once, and `campaign`/E6 never read anything in the `matching` module's tables again.** `campaign_pool_member` becomes the only interface the money path depends on, and it already existed before E3 shipped.

## Decision

`campaign_pool_member` is the sole hand-off point between E3 and everything downstream (E2's activation, E6's payments). When a `campaign_shortlist` transitions to `locked` (whether by campaign activation per US-13 scenario 3, or by an agency override per US-40), the `matching` module writes one row into `campaign_pool_member` per `campaign_shortlist_entry` with `included = true`, via the same insertion path E2 already designed for ("the actual creator-to-pool match itself is E3's shortlist/curation mechanism; E2 only needs a place to hold the allocation once E3 hands it a creator list," per the E2 architecture doc section 2.2). After that write, `campaign` and E6 never query `campaign_shortlist` or `campaign_shortlist_entry` again for any purpose. Opportunity acceptance/decline/expiry (US-28) updates `campaign_shortlist_entry.included` for *display and audit* purposes within `matching`, but the actual removal-from-pool effect that E2's reallocation and E6's payout code observe happens through an emitted domain event (`opportunity.declined`, `opportunity.expired`) that `campaign` already has a consumer for (its existing `pool-fill-check` job), not through a new read path into E3's tables.

## Consequences

**What Aurora gains:**
- The matching model -- scoring, weights, signals, even the shape of `campaign_shortlist_entry` itself -- can change arbitrarily as long as the final write into `campaign_pool_member` keeps the same shape, satisfying NFR-29's literal requirement: no campaign or payment code change, no migration, when the model improves.
- `campaign_pool_member` already has an RLS policy, constraints, and a battle-tested shape from E2; E3 does not invent a second "who is in the pool" representation that could drift out of sync with the first.
- Event-based signaling (`opportunity.declined`/`expired`) reuses a consumer E2 already built (`pool-fill-check`), rather than adding a second code path for the same "pool went short" concern.

**What Aurora gives up:**
- A small duplication: the final locked-shortlist creator list exists in both `campaign_shortlist_entry` (with full scoring/approval history) and `campaign_pool_member` (allocation only). This is intentional, not accidental -- the two tables answer different questions ("why was this creator chosen" vs. "how much are we paying them") and keeping them separate is what makes the interface narrow enough to satisfy NFR-29.
- If a bug causes the one-time write into `campaign_pool_member` to diverge from `campaign_shortlist_entry.included`, there is no live reconciliation between them (by design, since campaign/payment code never looks back at the shortlist). An audit-log-based reconciliation check is cheap to add later if this becomes a real operational concern.
