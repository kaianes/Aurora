# ADR-0017: Authenticity Score Is Flag-Only, Two-Tier Threshold, Never an Automatic Exclusion

**Status:** Proposed
**Date:** 2026-10-05
**Epic:** E3 -- Creator Matching and Curation
**Governs:** US-12, FR-10

## Context

PRD open question 5 notes that FR-10 requires an authenticity score to be computed and exposed, but does not define a threshold below which a creator is automatically excluded from matching versus merely flagged. US-12's own acceptance criteria already lean toward flagging only ("does not automatically remove the creator from the shortlist. The decision to approve or reject stays with Marina"), and the epic's stated strategic role is explicitly to preserve human judgment rather than automate it away. Still, a threshold number has to exist somewhere for the "prominently surfaced" requirement (US-12 scenario 2) to mean anything concrete, and the open question asks for that number to be set deliberately rather than left to whoever implements the frontend.

Two options:

- **A single hard cutoff**: below some score, auto-exclude from the shortlist entirely; above it, show the score with no particular emphasis. Rejected outright by the stories' own acceptance criteria -- US-12 scenario 2 explicitly forbids automatic removal, and FR-28's principle that approve/reject decisions belong to the buyer would be partially defeated by a pre-filter that removes the choice before it ever reaches her.
- **A two-tier flag with no exclusion at any tier**: scores below a "low" threshold are flagged in a way the frontend must render prominently (not buried); scores in a middle "review" band get a softer flag; scores above both are shown with no flag. No tier removes a creator from matching or the shortlist.

## Decision

Authenticity score is never used as a matching or shortlist-inclusion filter. `RealMatchingEngineAdapter`'s eligibility gate (ADR-0011) does not reference `authenticity_score` at all -- a creator with a score of 5 is exactly as eligible to be ranked as one with a score of 95; the score affects only how the creator is *displayed*, not whether they appear. The displayed flag uses two thresholds, chosen as the pilot default and explicitly open to product revision once real score distributions exist to calibrate against:

- `authenticity_score < 50`: `authenticity_flag = "low"`. The frontend contract (section 3.3 of the architecture doc) requires this tier to render with a distinct, non-dismissible visual treatment on the creator detail view (not merely a colored badge among many other metrics).
- `50 <= authenticity_score < 70`: `authenticity_flag = "review"`. Shown, less emphasized than "low," but never hidden or defaulted-collapsed.
- `authenticity_score >= 70`: `authenticity_flag = "none"`.

The thresholds live in the same configuration object as the matching weights (ADR-0011), not the database, so they can be recalibrated without a migration.

## Consequences

**What Aurora gains:**
- Full compliance with the explicit acceptance criteria in US-12 and the epic's stated strategic purpose: automation drafts and surfaces, humans decide.
- A concrete, implementable threshold exists today, so backend-dev and frontend-dev are not left guessing at what "prominently" means, and the API contract (`authenticity_flag`) is stable even as the exact numeric cutoffs get tuned later.
- Keeping authenticity entirely out of the ranking/eligibility gate means a legitimate but currently-mismeasured creator (a false positive on authenticity, which fraud-detection signals are known to produce) is never silently removed from consideration -- only flagged for a human to weigh against everything else they know.

**What Aurora gives up:**
- A badly flagged creator can still rank highly on fit and reach the shortlist's top positions, relying entirely on Marina (or Renata) to actually look at the flag before approving. This is the accepted cost of the "humans decide" design; mitigated by the non-dismissible, prominent rendering requirement rather than a backend-side filter.
- The specific numeric cutoffs (50/70) are a product judgment call made here under the PRD's instruction to resolve rather than defer, and are explicitly marked in this ADR and the architecture doc as a pilot default subject to revisiting -- a future change to these numbers requires no schema work, only a config update.
