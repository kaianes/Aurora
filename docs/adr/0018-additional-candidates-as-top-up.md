# ADR-0018: "Request Additional Candidates" Is a Top-Up Against the Existing Shortlist and Locked Price, Never a New Quote

**Status:** Proposed
**Date:** 2026-10-05
**Epic:** E3 -- Creator Matching and Curation
**Governs:** US-13, FR-28, FR-17, FR-18

## Context

PRD open question 4 flags that FR-28 lets the buyer reject individual creators, and US-13 scenario 2 requires the system to "offer to request additional candidates" when rejections drop the approved pool below the guaranteed minimum, but neither the story nor FR-28 specifies whether that request re-triggers a new quote (US-06) or simply tops up the existing one. The question explicitly notes this "touches the pricing promise in US-07," which is the crux: US-07/FR-18 hold the campaign's total price fixed once confirmed, absorbing any variance in creator cost. A new quote implies a new price computation, which risks reopening a promise E2 already closed at confirmation.

Two options:

- **Re-run the full quote flow** (`POST /campaigns/:id/quote`), producing a new `campaign_quote` row and potentially a new total price, then reconcile that against the already-locked price from confirmation. Rejected: this reopens FR-18's fixed-price guarantee for a scenario (the buyer being more selective than the algorithm anticipated) that has nothing to do with creator cost variance, the actual thing FR-18 is protecting the buyer from. It would also require new reconciliation logic in `campaign` (how does a second quote interact with an already-`confirmed` campaign?) that does not exist and would be invented solely for this edge case.
- **A top-up against the same shortlist and the same price**: re-run the matching engine for additional candidates only, excluding everyone already on the shortlist (any decision), targeting only the remaining shortfall (not the full original minimum), and append the results to the existing `campaign_shortlist` without touching `campaign_quote` or the campaign's locked price at all.

## Decision

`POST /campaigns/:id/shortlist/request-additional-candidates` is a top-up, not a requote. It calls `MatchingEngineAdapter.generateShortlist` with `alreadyOnShortlistCreatorIds` populated (so no duplicate entries) and a target count equal to the *remaining* shortfall (`guaranteed_min_pool_size` minus currently-included, non-rejected entries), not the original full minimum. New entries are appended to the same, still-open `campaign_shortlist` row with `origin = system_ranked` and `decision = pending`, ready for Marina to approve or reject exactly like the original batch. No `campaign_quote` row is created or modified, and the campaign's locked price (set at confirmation, per FR-18) is never touched. If the engine cannot fill the remaining gap even with the broader candidate pool (everyone not already on the shortlist), `additional_candidates_request.status = no_additional_candidates`, and the buyer's only remaining recourse is the existing FR-19 shortfall-at-launch mechanism in E2, not a repeated top-up loop.

## Consequences

**What Aurora gains:**
- FR-18's fixed-price promise stays genuinely fixed through this flow -- rejecting creators and asking for more never changes what the buyer pays, which is the correct reading of "my cost is predictable and needs no per-creator negotiation" (US-07) extended to a scenario US-07 did not originally anticipate but clearly should cover.
- No new reconciliation logic between a hypothetical second quote and an already-confirmed campaign; the top-up reuses the same shortlist state machine and the same `generateShortlist` method the original request used, just with different input parameters (already-seen creators excluded, smaller target count).
- The buyer gets a fast, low-friction way to recover from over-rejecting without restarting any part of the purchase flow.

**What Aurora gives up:**
- If the matching engine's candidate pool genuinely cannot support the guarantee (a narrow niche that was already thin at quote time), repeated top-up requests will not manufacture creators that do not exist -- the system is honest about `no_additional_candidates` rather than appearing to retry indefinitely, but this does mean the buyer can hit a real ceiling with no further automated recourse beyond the FR-19 financial remedy (refund or revised guarantee) already built in E2.
