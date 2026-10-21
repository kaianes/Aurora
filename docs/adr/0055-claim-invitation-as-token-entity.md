# ADR-0055: Claim and Invitation Lifecycle Modeled as Its Own Token-Based Entity, Decoupled From `creator.status`

**Status:** Proposed
**Date:** 2026-10-21
**Epic:** E8 -- Creator Recruitment and Growth
**Governs:** US-23.2, FR-13, NFR-21, NFR-22

## Context

FR-13 requires "an invitation and claim flow in which the creator confirms or corrects imported data before the profile becomes active, or declines and triggers deletion of the imported data." `creator.status` (E3, ADR-0013) already carries exactly two values relevant here (`unclaimed`, `active`) with a third (`suspended`) unrelated to this flow. The question this ADR resolves is whether the invitation/claim process itself needs its own tracked lifecycle (who was invited, when, whether they responded, whether a second invitation attempt is possible) or whether `creator.status`'s existing two-value transition is sufficient to represent the whole flow.

Two options were considered:

- **Represent the entire claim flow as `creator.status` transitions alone**, with no separate invitation record -- e.g., add timestamps like `invited_at`/`invitation_expires_at` directly on `creator`. Rejected: this conflates two different facts that need to vary independently. `creator.status` answers "is this profile visible and claimable right now," a question with exactly the values E3 already defined. "Has an invitation been sent, when, to what contact address, and did it expire unanswered" is a separate question with its own lifecycle, and a creator could plausibly need a *second* invitation attempt (a first one expiring unanswered, section 4.2's "a first invitation expiring unanswered does not preclude a second attempt") -- something a single pair of columns on `creator` cannot represent without either overwriting the first attempt's record or growing an unbounded number of `invited_at_2`, `invited_at_3` columns.
- **A dedicated `creator_invitation` table**, structurally mirroring E1's own workspace `invitation` table (`backend/src/database/entities/invitation.entity.ts`): a token, a status enum, an expiry, a responded-at timestamp -- a pattern this codebase has already built, tested, and reasoned about once.

A second question: does accepting an invitation and confirming corrected data have to be two separate API calls (an explicit "accept" step distinct from "confirm with corrections"), or can they be combined into one?

The stories document's own acceptance criteria state "the profile only becomes active (`status = active`) after she confirms it, not automatically on acceptance alone" -- read literally, this implies two distinct moments: opening/reviewing the invitation (which is not yet "accepting" in a way that activates anything) and a later, explicit confirmation. In practice, nothing meaningful happens between "she opens the invitation and sees the data" and "she submits her corrections and confirms" that would need its own persisted state transition -- there is no partial-acceptance state this platform needs to track separately, and splitting it into two API calls would add a step to a flow NFR-24 already budgets tightly (though NFR-24 technically governs the *onboarding* flow, not the claim flow, the same economy-of-steps reasoning applies). The sentence is read as describing the **outcome** (no automatic activation merely from opening or clicking a link) rather than mandating two separate persisted transitions.

## Decision

`creator_invitation` (E8 architecture doc section 2.2) is a dedicated table, structurally identical in spirit to E1's `invitation`: a unique, cryptographically random `token`; a `status` enum (`pending | accepted | declined | expired`); a 7-day `expires_at` (the same default E1 already chose for its own invitation, reused here rather than inventing a different window with no stated reason to differ); `contact_email` captured by the inviting operator since an unclaimed profile carries no verified contact channel of its own.

**Opening the invitation (`GET /creator-portal/invitations/:token`) is read-only and changes no state.** The single, explicit transition from `pending` happens only at `POST /creator-portal/invitations/:token/confirm` (accept-with-corrections, setting `creator_invitation.status = accepted` and `creator.status = active` together, in one transaction) or `POST /creator-portal/invitations/:token/decline` (`status = declined`, followed immediately by hard deletion of the `creator` and `creator_public_import` rows). There is no intermediate "accepted but not yet confirmed" status value, because no scenario in US-23.2 describes a creator who has accepted-but-not-yet-confirmed needing to be represented differently from one who simply has not opened the link yet -- both are `pending` until she actually acts.

## Consequences

**What Aurora gains:**
- The invitation lifecycle and the claim-status lifecycle are each represented by the table whose job it actually is: `creator_invitation` answers "did Aurora reach out, and how did it go," `creator.status` answers "is this profile live." Neither table has to grow columns to answer the other's question.
- Reusing E1's own invitation shape (token, status enum, expiry convention) means this is the second time this codebase has built this exact pattern, not a novel design decision with its own risk of a subtly different bug (e.g., a different token-generation scheme, a different expiry-check boundary condition).
- Multiple invitation attempts for the same unclaimed profile are representable without schema contortion -- each attempt is simply another row.

**What Aurora gives up:**
- A creator_invitation row persists after its creator row is deleted only in the decline case (where it is deleted in the same transaction, per section 4.5 of the architecture doc) -- but in the 90-day unclaimed-expiry case, any still-`pending` `creator_invitation` rows are also deleted by `expire-unclaimed-profiles` (section 9), meaning this epic deliberately does **not** retain a durable record of "we tried to invite this specific person and they never responded" past that deletion, beyond whatever the audit log independently captured. This is consistent with NFR-20's "deletes everything it imported" framing extending to the invitation's own trail, not an oversight, but it does mean recruitment-funnel analytics (open question 8) cannot be reconstructed from this table alone past the 90-day window -- only from the audit log, if retained long enough.

**Risk:** None beyond the general risk any token-based, pre-authentication endpoint carries (a leaked invitation link grants the same access the intended recipient would have) -- mitigated the same way E1's own workspace invitation token already is, by the token being cryptographically random and single-purpose, and by the claim-confirm endpoint requiring her to set her own password before anything becomes permanently hers, so a leaked link alone cannot be used to silently take over an account without the person who clicks it establishing a credential in the process.
