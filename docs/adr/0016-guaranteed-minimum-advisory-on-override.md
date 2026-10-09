# ADR-0016: The Guaranteed Minimum Applies to Agency Overrides, but as a Warning, Not a Blocking Gate

**Status:** Proposed
**Date:** 2026-10-05
**Epic:** E3 -- Creator Matching and Curation
**Governs:** US-40, US-06, US-07, FR-17, FR-19, FR-29

## Context

PRD open question 2 asks whether Renata's curated selection must still meet the guaranteed minimum pool size from the quote (FR-17), or whether an agency override is exempt from that guarantee because it is a judgment call rather than an algorithmic fill. The guarantee itself (US-06, US-07) is a commercial promise Aurora made to the buyer at quote time, independent of who assembles the final pool -- the brand (or agency acting for the brand) paid for a specific minimum reach, and that promise does not logically depend on whether a human or an algorithm picked the final names.

Two options:

- **Exempt agency overrides from the guarantee entirely**, on the theory that curation is deliberately smaller and higher-quality rather than algorithmically complete. Rejected: this would mean two campaigns paying the identical quoted price could receive very different guarantees depending only on which role saved the final shortlist, which undermines the fixed-price promise at the center of E2 (FR-18) and gives agencies an unstated incentive to "curate" down to a thin pool without ever triggering the shortfall-notification obligation (FR-19) that protects the buyer.
- **Enforce the guarantee as a hard blocking gate on the override save**, rejecting any override whose final pool size is below the quoted minimum. Rejected: FR-29 explicitly protects Renata's save as final and non-reordered -- a hard gate that can reject her save contradicts that guarantee and would force her into an awkward loop of adding creators she doesn't actually want just to satisfy a number, undermining the entire point of the feature (preserving her judgment, per the epic's own strategic framing).

## Decision

The guaranteed minimum pool size continues to apply to the *final* shortlist regardless of who produced it, including after an agency override. The override endpoint (`POST /campaigns/:id/shortlist/override`) is never blocked by a shortfall: the save always succeeds. If the resulting `included` entry count is below `guaranteed_min_pool_size`, `campaign_shortlist.below_guaranteed_minimum` is set to `true`, the same flag US-11 scenario 2 and US-13 scenario 2 already use, and the agency is shown the same warning the matching engine itself would show for a narrow niche. This flows into the *existing* FR-19 mechanism in E2 (the `pool-fill-check` job, scheduled before launch), which is the single place the shortfall-resolution choice (refund vs. revised guarantee) is offered -- E3 does not invent a second, override-specific shortfall flow. An agency override that leaves the pool short therefore produces exactly the same downstream consequence as a quoted campaign that simply could not find enough eligible creators: the buyer (here, the agency acting for the client) is notified before launch and offered the standard resolution.

## Consequences

**What Aurora gains:**
- One shortfall-resolution mechanism for the entire epic, regardless of path (algorithmic shortfall, rejection-driven shortfall per US-13 scenario 2, or override-driven shortfall) -- backend-dev builds and tests one flow, not three near-duplicates.
- The fixed-price guarantee (FR-17/FR-18) holds its meaning consistently: the commercial promise does not get quietly weaker just because an agency curated the pool.
- Renata's authority over the *content* of the shortlist (FR-29) is fully preserved -- nothing about her save is ever rejected or reordered by this rule, only flagged, which is consistent with "her list is authoritative once saved."

**What Aurora gives up:**
- An agency can, in principle, save a shortlist well below the guarantee with no immediate friction beyond a warning, and only face a consequence (refund or revised guarantee, both financial) at the pre-launch shortfall check rather than at save time. This is accepted because the alternative (blocking the save) was already rejected as incompatible with FR-29, and the warning is visible immediately, not hidden until launch -- the agency is never surprised, even though the gate is advisory rather than blocking.
