# ADR-0014: Brand Exclusion Lists Apply Unconditionally to Agency Network Additions

**Status:** Proposed
**Date:** 2026-10-05
**Epic:** E3 -- Creator Matching and Curation
**Governs:** US-14, US-40, FR-27, FR-29

## Context

PRD open question 3 asks directly whether a brand's exclusion list (US-14) binds an agency's own-network additions (US-40), or whether agency curation can override a client's exclusion list. The two stories otherwise don't interact in the acceptance criteria: US-14 is framed entirely around system-ranked shortlists, and US-40 is framed entirely around Renata's judgment. Left unresolved, the override endpoint (3.6 of the architecture doc) would have to pick a default behavior anyway, and getting it wrong is a brand-safety incident waiting to happen, not a cosmetic gap -- the specific reason US-14 exists is "so that conflicts never reach a shortlist," including "competitor associations."

Two options:

- **Agency curation is exempt from brand exclusions**, treating "my curation stays the product I sell" (US-40's own framing) as license to override anything, including the client's own stated exclusion list. Rejected: this would let an agency unknowingly (or knowingly) put a client's declared competitor-affiliated creator in front of that client's brand, which is precisely the harm US-14 exists to prevent, and it would mean a brand's safety control is weaker the moment it works with an agency than when it manages its own campaigns -- backwards for a feature whose whole pitch to agencies is operating *as* the client's account under the client's constraints (per US-39's framing and E9's isolation guarantee).
- **Exclusions bind every path that can put a creator on a locked shortlist**, system-ranked or agency-added, with no override capability for either role.

## Decision

Brand- and campaign-level exclusions (`creator_exclusion`) are enforced identically regardless of path. `POST /campaigns/:id/shortlist/override` (US-40) validates every `add_creators` entry against the same exclusion check that shortlist generation (US-11) runs before ranking. An agency attempting to add an excluded creator receives 422 with a code distinguishing this case from "not eligible" (`CREATOR_EXCLUDED`, not `CREATOR_NOT_ELIGIBLE`), naming which exclusion (brand-level or campaign-level, and whether it was a named creator or a competitor-association match) blocked the addition. There is no override of an override: no role, including `agency_admin`, can bypass an exclusion through this endpoint. If an agency genuinely needs a creator unblocked, the client's own exclusion list must be edited through the exclusion endpoints (3.5), which are available to `agency_operator`/`agency_admin` acting with client access exactly as they are to the client's own `brand_owner`/`brand_manager` -- the agency can change the rule through the front door, never route around it through curation.

## Consequences

**What Aurora gains:**
- A single, unconditional safety guarantee: no creator a brand has named, or associated with a named competitor, can ever reach that brand's locked shortlist, regardless of whether a human algorithm (the matching engine) or a human curator (Renata) produced the entry. This matches the plain-language promise of US-14 ("conflicts never reach a shortlist") without a silent carve-out for agency clients.
- Agencies retain full control of their own curation workflow, including the ability to fix a mistaken exclusion, just through the same auditable, visible path every other actor uses -- no hidden bypass that a later audit would have to explain.
- One enforcement point (the exclusion check) is shared by both the matching engine's filter and the override endpoint's validation, so there is no risk of the two drifting apart over time.

**What Aurora gives up:**
- Renata loses a small amount of autonomy in the specific case where she disagrees with a client's exclusion choice and cannot immediately reach someone at the client to change it. This is judged acceptable: brand safety here outranks curator convenience, and the front door (editing the exclusion list) is fast (a single API call, same role tier) rather than a multi-day process.
