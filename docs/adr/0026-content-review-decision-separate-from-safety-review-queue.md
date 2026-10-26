# ADR-0026: A Dedicated `content_review_decision` Entity, Separate From E4's Safety Review Queue

**Status:** Proposed
**Date:** 2026-10-21
**Epic:** E5 -- Briefing and Content Workflow
**Governs:** US-19, US-33, FR-40

## Context

FR-40 ("the system shall require a stated reason whenever a draft is rejected, and make that reason visible to the creator") is shared between E4's US-17 (flagged-content review) and this epic's US-19/US-33. E4 already implements the shared obligation once, inside `safety_review_queue_item`: a decision record with a three-way status (`approved` / `rejected` / `revision_requested`), a conditionally required `decision_reason`, and `decided_by_user_id`/`decided_at`.

US-19 is a different question from US-17, even though it reuses the same obligation's wording. E4's review queue exists only for content the **automated safety check flagged or could not evaluate** (section 2.2 of the E4 architecture document: "created automatically, in the same transaction that sets `safety_check.status` to `flagged` or `check_unavailable`"). US-19 requires a decision on **every** draft Marina reviews, whether or not brand safety ever flagged it -- the two questions ("is this safe to publish" and "is this the creative work we want") are independent and a submission can have either answer in either combination.

Two options were considered:

- **Reuse `safety_review_queue_item` for both purposes**, adding a new `reason_category` value (e.g., `creative_review`) and creating a row for every submission regardless of its safety-check outcome. This would overload one table with two conceptually distinct questions and would require E4's gate computation (`BrandSafetyGateService.getGateStatus`, section 2.8 of the E4 architecture document) to start distinguishing *which kind* of review item it is reading before computing the safety gate -- exactly the kind of coupling that would make a future change to either review process risk breaking the other.
- **A new, dedicated `content_review_decision` entity**, 1:1 with `content_submission`, created explicitly by Marina's decision action rather than automatically by a safety-check outcome.

## Decision

E5 defines `content_review_decision` (section 3.2 of the E5 architecture document), unique on `content_submission_id`, reusing the exact same status vocabulary (`approved` / `rejected` / `revision_requested`) and the exact same stated-reason rule (`decision_reason` required unless `decision = approved`, enforced in the service layer, written atomically with the decision) that E4's `review-queue.service.ts` already established for the analogous obligation. This is a deliberate, visible consistency: the same FR-40 obligation looks the same wherever it appears, but it is recorded in a table E4's gate computation never reads and never needs to know exists.

`BrandSafetyGateService.getGateStatus` is unchanged by this decision -- it continues to compute the safety gate from `safety_check` and `safety_review_queue_item` alone, exactly as E4 built it. `content-workflow`'s own endpoints are the only code that reads `content_review_decision`, except at the one point both records are read together: publication confirmation (ADR-0027).

## Consequences

**What Aurora gains:**
- E4's gate computation is untouched, unextended, and unaware this epic exists -- the narrowest possible blast radius for a new epic building on top of an already-shipped one, consistent with NFR-29's framing applied one layer further than E4 itself applied it.
- Marina can review and decide on a draft whether or not brand safety has finished checking it, finished flagging it, or ever flags it at all -- the two processes run on independent clocks, which matches how the two questions ("is this the creative work we want" vs. "is this safe to publish") are actually independent in practice.
- The identical vocabulary and stated-reason rule across both tables means a developer who has worked on E4's review queue needs no new mental model to work on E5's decision endpoint, and vice versa -- reusing a proven pattern rather than inventing a new one for a structurally similar problem.

**What Aurora gives up:**
- Two tables now exist that look superficially similar (same status enum, same reason rule) but answer different questions, which is a genuine source of confusion for a developer encountering both for the first time without reading section 2 of the E5 architecture document ("Two Decision Records, Not One"). The mitigation is documentary: that section exists specifically to name the distinction before anyone has to rediscover it from the schema alone.
- A future requirement to show Marina "everything that's ever been decided about this submission, safety and creative together, in one timeline" would need a read-side join across two tables rather than one table's history. Nothing in the current stories document asks for that view; if it is needed later, it is a read-model addition, not a schema change to either table.

**Risk:** None beyond the confusion risk named above, which section 2 of the architecture document exists to mitigate directly.
