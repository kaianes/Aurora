# ADR-0027: Publication Confirmation Requires Two Independent, Separately Computed Gates

**Status:** Proposed
**Date:** 2026-10-21
**Epic:** E5 -- Briefing and Content Workflow
**Governs:** US-34, FR-42, FR-33

## Context

US-34 scenario 1 states the precondition for a successful publication confirmation explicitly: "Duda's draft has been approved (US-19) **and** its content has cleared the brand safety gate (US-16/FR-33, E4)." These are two separate facts, produced by two separate processes on two separate clocks (ADR-0026): Marina's creative decision (`content_review_decision`), and the automated-plus-possibly-human-reviewed safety verdict (`safety_check` plus, where applicable, `safety_review_queue_item`, read through `BrandSafetyGateService.getGateStatus`).

A submission can be in any of four combined states at the moment Duda attempts to confirm publication: approved-and-cleared, approved-but-not-cleared, not-yet-decided-but-cleared, or neither. Only the first should succeed. The question this ADR answers is where that combination is checked, and how the two independent failures are distinguished for Duda.

## Decision

The publication-confirmation endpoint (`POST /creator-portal/content-submissions/:id/confirm-publication`, section 4.6 of the E5 architecture document) checks both gates explicitly, in sequence, each with its own distinct error code:

1. `content_review_decision` must exist for this exact submission and equal `approved`. If not: `409 DRAFT_NOT_APPROVED`.
2. `BrandSafetyGateService.getGateStatus(contentSubmissionId)` must return `cleared: true`. If not: `409 SAFETY_NOT_CLEARED`, with `details.blocking_reason` echoing the gate's own value.

Neither check is collapsed into the other, and neither table is taught to know about the other's existence. `content_review_decision` carries no column referencing `safety_check` or `safety_review_queue_item`, and `BrandSafetyGateService`'s own interface is unchanged -- it has no parameter and no return value concerning Marina's creative decision. The two gates are combined only at this one call site, by `content-workflow`'s own endpoint code, and nowhere earlier in either pipeline.

## Consequences

**What Aurora gains:**
- US-34 scenario 3's "states the specific reason" guarantee holds precisely: a creator who has not yet been creatively approved sees `DRAFT_NOT_APPROVED`, distinct from one whose content has not cleared brand safety (`SAFETY_NOT_CLEARED`), distinct from a link problem (`PUBLICATION_LINK_UNREACHABLE`/`PUBLICATION_CONTENT_MISMATCH`, ADR-0031). Four possible failure reasons, four distinct codes, no ambiguity about which one applies.
- Either gate can evolve independently with zero risk to the other. A future change to how Marina's decision works (e.g., a second-reviewer requirement) touches only `content_review_decision`'s table and this endpoint's step 1; a future change to the safety cascade (already isolated behind `ContentSafetyAdapter`, ADR-0021) touches neither this endpoint's logic nor `content_review_decision` at all.
- `BrandSafetyGateService.recordPublication`'s own internal defense-in-depth re-check (section 3.6 of the E4 architecture document: "the method itself re-checks `getGateStatus` and returns 409 `SAFETY_NOT_CLEARED`... a future E5 implementation calling this method is never trusted to have already enforced the gate correctly on its own") continues to hold exactly as E4 designed it. This epic's own step 2 check is intentionally redundant with that internal re-check, not a replacement for it -- removing this epic's check would not create a safety gap, because E4's own method still enforces it; keeping it anyway gives Duda a clear, early error rather than a less specific one surfaced only inside `recordPublication`'s failure path.

**What Aurora gives up:**
- Nothing structural. The two-gate check is two sequential, cheap reads (one row lookup, one service call that is itself a cheap read per section 2.8 of the E4 architecture document) -- no measurable cost to NFR-04's write budget.

**Risk:** None distinct from the risks each individual gate already carries on its own (R-01's escalation-rate assumption for the safety side; none named for the creative-decision side, which is a simple row lookup).
