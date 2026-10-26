# ADR-0023: A Human Review Decision Overrides the Gate Without Mutating the Automated Verdict; the Queue Fails Closed

**Status:** Proposed
**Date:** 2026-10-20
**Epic:** E4 -- Brand Safety
**Governs:** US-17, FR-34, NFR-16

## Context

US-17 requires that flagged content (and, per ADR-0022, check-unavailable content) route to a human decision rather than being automatically rejected, and that the decision -- approve, reject with a stated reason, or request revision -- be Marina's to make, informed by every rule that triggered (US-17 scenario 2), not just the first one found. US-17 scenario 3 additionally requires that a degraded or unreachable review queue never cause an automatic rejection or automatic publication as a side effect of the outage, and that the failure be shown honestly rather than as a blank or misleadingly empty list.

Two design questions follow directly from this:

1. **Where does a human's decision live, relative to the automated verdict?** It could overwrite `safety_check.status` directly (e.g., change a `flagged` row to `passed` once Marina approves it), or it could live in a separate record that the gate computation reads alongside the original verdict.
2. **What happens, structurally, when the review queue's read path is degraded?** This could be handled by special-case error logic in the queue endpoints, or it could be handled by ensuring the thing those endpoints read from can never itself represent "cleared" by default, so a read failure has nothing unsafe to expose even in principle.

## Decision

**Human decisions are recorded as a separate, append-style fact (`safety_review_queue_item`), never as a mutation of `safety_check`.** Approving a flagged item does not change `safety_check.status` from `flagged` to `passed` -- it sets `safety_review_queue_item.status = 'approved'`, and the gate computation (section 2.8 of the E4 architecture document) reads both records to decide `cleared`. This preserves the automated verdict exactly as the model(s) produced it, permanently, alongside the human's override of it. `docs/architecture.md` section 2.4 already states the general principle this follows: "`SAFETY_VERDICT` is likewise its own entity, not a column on `SUBMISSION`, because a submission can be evaluated more than once and by more than one tier" -- the same reasoning extends naturally to "evaluated once by a model and once by a human," which are two distinct facts about the same content, not one fact that the second overwrites.

**The review queue fails closed by construction, not by special-case handling.** The gate's default state (section 2.8's table) has no row, no status, and no error condition that maps to `cleared`. A submission starts `blocked` and stays `blocked` until an explicit `passed` verdict or an explicit `approved` review decision exists. This means US-17 scenario 3's requirement -- that an unreachable queue never results in an automatic approval or publication -- is not a property the queue's error-handling code has to get right under pressure; it is a property of what "cleared" already requires, which a read-path outage cannot produce, because a read-path outage produces no rows at all, and no rows is exactly the `blocked` default. The queue's `GET` endpoints return a 503 with a clear, structured error (`REVIEW_QUEUE_UNAVAILABLE`) rather than an empty array specifically so the frontend can distinguish "nothing is flagged" from "I could not check," per US-17 scenario 3's explicit requirement that the two never look the same to Marina.

## Consequences

**What Aurora gains:**
- The automated verdict and the human verdict are both permanently auditable, independently. A later question like "did the model actually flag this, or did it time out and a human just never got to it" is answerable from the stored data without reconstructing it from an audit log alone.
- Fail-closed-by-construction means there is no scenario-3-specific code to write, test, or get wrong under outage pressure. The property holds because of how the default is defined, not because of a conditional that checks for an error and remembers to do the safe thing.
- Multiple triggered rules on one flagged item (US-17 scenario 2) are a natural consequence of `safety_rule_trigger` being one row per (rule, channel) pair, already established in ADR-0021 for a different reason -- this ADR does not need its own mechanism for that requirement, it inherits one that already exists.

**What Aurora gives up:**
- Computing gate status requires a small join (latest `safety_check` plus its `safety_review_queue_item`, if any) on every read, rather than a single-column lookup. At pilot scale (NFR-06's 150-creator ceiling) this is negligible; if gate-status reads ever became a hot path at much larger scale, a materialized/denormalized `content_submission.gate_status` column could be added as a read optimization without changing the underlying model -- the computation described here would become the thing that populates it, not something replaced.
- A rejected or revision-requested decision is permanent for that specific `content_submission` row -- there is no "undo" on a human decision in this design. A changed mind requires a new submission (once E5 exists to produce one) and a new check, which is consistent with treating a human's reject/revision call with the same seriousness as a rule-triggered flag, not as a casual toggle.

**Risk:** None specific to this decision beyond what ADR-0022 already names for `check_unavailable` volume; this ADR governs how any queue item (regardless of why it is there) is decided and read, not how it got there.
