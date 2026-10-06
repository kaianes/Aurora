# ADR-0005: Campaign Pool Allocation as a Per-Creator Row Table

**Status:** Proposed
**Date:** 2026-10-05
**Epic:** E2 -- Campaign Planning and Pool Buying
**Governs:** US-06, US-07, US-10, FR-16, FR-17, FR-23

## Context

A confirmed campaign commits a fixed total price (FR-18) across a pool of up to 150 creators (NFR-06), and that allocation changes over the campaign's life through budget reallocation (FR-23, US-10). The system needs a representation of "how much budget is assigned to creator X right now" that supports:

- Reads and writes that stay proportional to the number of creators touched, not the whole pool, so reallocation and publication events do not degrade as pool size grows toward the pilot ceiling of 150 (NFR-06) and do not become a linear-cost trap as pools grow toward 5,000 later (NFR-34).
- A hard guarantee that money already earned by a creator (because they published) can never be clawed back by a later reallocation (US-10 scenario 2, and the broader payment integrity promise in NFR-13 that governs E6).
- An audit trail of every reallocation, including cycles that were skipped due to missing or stale data (US-10 scenario 3).

Two options were considered:

- **Embedded JSON on the campaign row.** Store the pool as a `jsonb` array of `{creator_id, allocated_budget, committed_budget, status}` on the `campaign` table itself. Simple to read in one query. But every reallocation write rewrites the entire array (the whole JSON document), so write cost grows with pool size even when only a handful of allocations change in a cycle -- exactly the linear-scaling risk NFR-34 flags. It also makes it harder to enforce "committed_budget never decreases" as a database-level invariant, since Postgres cannot easily constrain values nested inside a JSON array.

- **A row-per-creator table (`campaign_pool_member`), with a dedicated append-only event log for reallocation history.** Each creator's allocation is a row. A reallocation touches only the rows whose allocation changed. A database trigger enforces that `committed_budget` is monotonically non-decreasing per row. A separate `campaign_reallocation_event` table records before/after snapshots and outcomes (including skips) without needing to diff JSON blobs after the fact.

## Decision

Pool composition and allocation are modeled as a dedicated table, `campaign_pool_member`, one row per creator per campaign, with a separate append-only `campaign_reallocation_event` table for history.

- `campaign_pool_member.allocated_budget` is the creator's current total committed-plus-remaining target; it can move up or down by reallocation while the creator has not yet published.
- `campaign_pool_member.committed_budget` is the portion already earned (publication confirmed, per FR-42/FR-44 in E6). A database trigger (`prevent_committed_budget_decrease`) rejects any update that would lower it.
- Reallocation writes update only the subset of rows whose target changed in that cycle, and log one `campaign_reallocation_event` row per cycle (not per creator) with before/after snapshots as a `jsonb` diff, which is acceptable here because that document is written once and never patched in place -- it is not the mutable state, only its history.
- Reads that need the whole pool (e.g., rendering the pool list) paginate over `campaign_pool_member` rather than returning one unbounded document.

## Consequences

**What Aurora gains:**
- Reallocation cost is proportional to the number of creators actually reallocated in a cycle, not the pool size, satisfying NFR-34's intent even before formal verification at 5,000-creator scale.
- A database-enforced invariant (committed budget cannot decrease) gives a correctness guarantee independent of application code discipline, which matters because this is adjacent to the payment integrity promise (NFR-13) owned by E6.
- Pagination over pool members keeps list reads within NFR-04's targets regardless of pool size, up to and beyond the 150-creator pilot ceiling.
- Reallocation history is queryable and filterable (by outcome, by date) without parsing JSON, which backend-dev and frontend-dev both need for US-10 scenario 1's "records the reallocation in the campaign's history."

**What Aurora gives up:**
- One more table and one more RLS policy to maintain (join-based, since `campaign_pool_member` has no direct `account_id`), versus a single-table embedded approach. This is a small, well-understood cost given the existing E1 pattern already established join-based RLS conventions.
- Slightly more complex queries to assemble a full campaign view (a join instead of one row fetch), mitigated by the GET /campaigns/:id endpoint doing that join server-side once, not leaving it to the frontend.

**Risks:**
- If pool sizes grow far beyond 5,000 (post-pilot), the reallocation job's per-cycle work still touches every pool member with sufficient performance data at least once to compare them, which is linear in pool size per cycle even though it is not quadratic. This is consistent with NFR-34's own framing (designed for at pilot scale, formally verified later) and is not a regression introduced by this decision; it is the honest floor of a reallocation feature over a bounded data set.
