# ADR-0028: Briefing Q&A as a Per-Creator Private Thread, With No Response-Time Obligation

**Status:** Proposed
**Date:** 2026-10-21
**Epic:** E5 -- Briefing and Content Workflow
**Governs:** US-31, FR-38

## Context

FR-38 ("the system shall provide a question-and-answer thread on each briefing, visible to the creator who asked and to the buyer") is a Should-priority requirement with two structural properties stated explicitly in the stories document: the thread is **private between one creator and the buyer**, even though the briefing content itself is shared across the whole pool (US-31 scenario 2); and the PRD states **no response-time obligation** for it, unlike FR-41's explicit deadline-and-escalation requirement for draft review (US-31 scenario 3, PRD open question 1). Both properties need a concrete shape before backend-dev and frontend-dev can build against a single contract.

Two structural options were considered for the thread's scope:

- **One shared thread per briefing**, with every message visible to every creator in the pool, and a sender attribution distinguishing who asked what. This models a FAQ-style shared thread, which some briefing tools use deliberately (so one creator's question benefits everyone). It directly contradicts US-31 scenario 2's explicit requirement that creator B never sees creator A's question.
- **One private thread per (briefing, creator) pair**, created lazily on that creator's first question, with messages visible only to the asking creator and any brand-side user with account access to the campaign.

## Decision

E5 defines `briefing_qa_thread` (unique on `briefing_id, creator_id`) and `briefing_qa_message` (section 3.2 of the E5 architecture document). Privacy is a property of the foreign key, not a runtime filter: a thread's row simply does not exist for any creator-briefing pair until that creator asks a question, and every query for "my thread" is `WHERE briefing_id = X AND creator_id = :callersCreatorId`, which structurally cannot return another creator's row.

No "answered" boolean is stored. Whether a thread is unanswered is computed at read time from whether its last message has `sender_type = creator` -- consistent with the principle (already used for `BrandSafetyGateService.getGateStatus`, section 2.8 of the E4 architecture document) that a fact derivable from existing rows should be derived, not cached, so it can never drift out of sync with the history that actually happened.

No SLA, deadline, or escalation mechanism is built for this thread, matching PRD open question 1's own framing precisely: "the acceptance criteria above only guarantee the question stays visibly recorded as unanswered; nothing further is specified or assumed." This is a deliberate asymmetry with FR-41's draft-review deadline (ADR-0030) -- the PRD draws that line itself, and this epic does not blur it by inventing an unstated obligation for a Should-priority feature the PRD explicitly declines to time-bound.

## Consequences

**What Aurora gains:**
- US-31 scenario 2's privacy guarantee is enforced by a unique constraint and a `WHERE` clause, not by application discipline alone -- the same category of structural guarantee E3/E4 already lean on for tenant isolation, applied here to a narrower, creator-level boundary instead of an account-level one.
- The thread list for Marina's side (`GET /campaigns/:id/briefing/qa`) is a simple one-row-per-creator list with no risk of leaking cross-creator content, because there is no row that spans more than one creator to begin with.

**What Aurora gives up:**
- If product later decides a shared FAQ view would genuinely help (one creator's clarified question benefiting the whole pool), that is a materially different feature built on top of this one, not a toggle on it -- the schema would need either a new "promote to shared" action or a parallel shared-announcement mechanism, since the privacy guarantee here is structural, not an opt-in flag that could be flipped per message.
- No notification exists when a creator's question is answered or when it goes unanswered for a long time -- Duda learns of an answer only by returning to the thread. This matches FR-38's Should priority and the PRD's own silence on an SLA; it is named here, not hidden.

**Risk:** None distinct from the general risk any un-timed support channel carries -- a question could sit unanswered indefinitely with no automated prompt to either side. This is an accepted consequence of the PRD's own scoping, not an oversight in this design.
