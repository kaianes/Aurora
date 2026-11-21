# ADR-0068: Fit Reason Generation at Shortlist-Generation Time, Not On-Demand

**Status:** Proposed
**Date:** 2026-11-16
**Epic:** E10 -- AI Creator Demo
**Governs:** NFR-01, NFR-04, NFR-29
**Related:** ADR-0011 (matching engine adapter), ADR-0012 (shortlist locking and indirection)

## Context

US-10.2 adds a plain-language `fit_reason` text field to every shortlist entry. The design question is: when is Claude called to generate this text?

Two strategies were considered.

**Option A -- On-demand, at read time:** The first time `GET /campaigns/:id/shortlist` is requested (or when a specific entry is viewed), the system calls Claude to generate the fit reason for that entry and stores it. Subsequent reads return the stored value.

**Option B (chosen) -- At shortlist-generation time, inside the shortlist job:** After scoring and ranking are complete (inside `RealMatchingEngineAdapter.generateShortlist()`), Claude is called for each entry before the results are returned to the job writer. The job writes the full entry including `fit_reason` in one operation. Subsequent reads from `GET /campaigns/:id/shortlist` return a stored value; Claude is never called at read time.

**Why Option A was rejected:**

Option A couples a user-facing read endpoint to an external AI call. Under NFR-04, reads must complete at p95 <= 500 ms. A Claude call takes 1-10 seconds. These two requirements are irreconcilable. An on-demand call could use an async "request and poll" pattern, but then the read endpoint would need to show a "generating" state, requiring the frontend to poll for individual entries -- a significant complexity increase for both backend and frontend.

There is also a staleness problem: if fit reasons are generated lazily, the first user to view the shortlist triggers the generation and waits; subsequent users see the stored value. This inconsistency in latency is confusing for a demo walkthrough where the audience expects the shortlist to already be complete when Marina opens it.

Option A does have one advantage: it defers Claude calls until they are actually needed. If a shortlist is generated but never viewed, no Claude calls are wasted. At pilot scale with a handful of demo campaigns, this saving is immaterial.

**Why Option B is chosen:**

The shortlist generation job is already asynchronous (ADR-0012's 202 + poll pattern). The p95 <= 60-second budget for shortlist generation (NFR-01) exists precisely to accommodate work that takes longer than a synchronous HTTP response can tolerate. Adding fit reason generation inside the job is a natural extension of work that already happens asynchronously: score, rank, generate reasons, write results. When the shortlist status transitions to `'ready'`, every entry has a `fit_reason` (or a `fit_reason_unavailable = true` flag). The read endpoint is then a plain database read with no AI dependency.

**NFR-29 and the adapter boundary:**

Fit reason generation happens inside `RealMatchingEngineAdapter.generateShortlist()`, not in the calling campaign module's job processor. This is correct: the matching adapter is responsible for producing shortlist entries, and `fit_reason` is part of a shortlist entry's content, not a decoration added by an outer layer. Placing the generation inside the adapter means the calling code never makes Claude calls directly; it simply reads the `fitReason` and `fitReasonUnavailable` fields from the returned `GenerateShortlistEntry` objects, the same way it already reads `fitScore` and `matchedAttributes`. Swapping `RealMatchingEngineAdapter` for a future implementation means the new implementation also returns fit reasons (or null values) -- the calling code is unchanged.

The calling code (campaign module's shortlist job writer) gains two new field writes: `entry.fitReason -> campaign_shortlist_entry.fit_reason`, `entry.fitReasonUnavailable -> campaign_shortlist_entry.fit_reason_unavailable`. This is a minimal mechanical change, not a logic change. The campaign module does not inspect or validate the content of `fitReason`.

**Parallelism and the NFR-01 budget:**

Generating fit reasons for 100 entries sequentially at ~2 seconds each would take ~200 seconds, far exceeding the 60-second budget. Parallel batches are required. The batch strategy is:
- Group entries into batches of `AI_FIT_REASON_BATCH_SIZE` (default 10, configurable via environment variable).
- Within each batch, issue all Claude calls concurrently using `Promise.allSettled()`.
- Each call uses `Promise.allSettled()` (not `Promise.all()`) so a failure in one entry does not cancel the remaining calls in the same batch.
- Run batches sequentially (not all 100 calls at once) to avoid exhausting the Anthropic API rate limit and to bound concurrent connection use.

At default settings (batch size 10, ~2 seconds per batch p95), 100 entries complete in approximately 20 seconds. Combined with scoring (5-10 seconds) and database writes (2-5 seconds), the total job duration is approximately 30-35 seconds at p95, leaving margin within the 60-second NFR-01 budget.

## Decision

**Fit reason generation runs inside `RealMatchingEngineAdapter.generateShortlist()`, after scoring and ranking are complete, in parallel batches before the result is returned to the calling job.**

The `GenerateShortlistEntry` interface (in `campaign/matching-engine.adapter.ts`) gains two new fields: `fitReason: string | null` and `fitReasonUnavailable: boolean`. The campaign module's shortlist job writer persists these fields to `campaign_shortlist_entry` without inspecting their content.

Agency-added entries (`origin = 'agency_added'`) are excluded from the generation loop. They are returned with `fitReason = null` and `fitReasonUnavailable = false`. The UI distinguishes this case from a failed generation (where `fitReason = null` and `fitReasonUnavailable = true`) without requiring two null checks in the same field.

The shortlist status becomes `'ready'` when scoring is complete, regardless of partial fit reason failures. A shortlist is not held back or failed because some fit reason calls timed out.

The `GenerateShortlistInput` interface gains two new fields to supply the prompt with campaign context: `campaignName: string` and `campaignBriefSummary: string | null`. The campaign module's shortlist job already has the campaign entity loaded; populating these fields requires no additional database query.

## Consequences

**What Aurora gains:**
- `GET /campaigns/:id/shortlist` is a plain indexed read with no AI dependency. It meets NFR-04's 500 ms read target unconditionally.
- When Marina opens the shortlist, every entry already has a fit reason (or a clear unavailability flag). There is no "generating" state to manage in the UI.
- Fit reason generation failures are localized to individual entries. A timeout on one entry does not affect other entries or the shortlist job overall.
- The adapter boundary (NFR-29) is preserved: the calling code never makes Claude calls directly.

**What Aurora gives up:**
- Fit reason generation always runs at shortlist generation time, even for shortlists that Marina may never view (e.g., a campaign that is immediately cancelled). At pilot scale, the cost of a few unused shortlist generations is immaterial. If Aurora scales to hundreds of campaigns per day with high attrition, revisiting this tradeoff is appropriate -- but that decision belongs to a future ADR with real usage data, not to this one.
- The 60-second NFR-01 budget is now shared between scoring and fit reason generation. If Claude latencies increase significantly (a model change, API congestion), the entire shortlist job could breach the budget even if scoring itself is fast. The `AI_FIT_REASON_BATCH_SIZE` and `AI_FIT_REASON_TIMEOUT_MS` environment variables provide operational levers to tune the budget split without a code change.
- The `GenerateShortlistEntry` interface is extended with two new fields. This is an interface change inside the matching adapter contract. The change is additive (new optional fields with defined null semantics) and does not break any existing consumer; but it is a real change to a shared interface that future matching engine implementations must also satisfy.
