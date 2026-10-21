# ADR-0035: The Pre-Acceptance "Expected Payment Date" Is a Projection, Not the Binding Commitment

**Status:** Proposed
**Date:** 2026-10-21
**Epic:** E6 -- Payments and Financial Transparency
**Governs:** US-29, FR-43

## Context

FR-43 requires showing a creator "the expected payment date" before they accept an opportunity. At that moment -- before the creator has even been briefed, let alone produced or published anything -- the one event the actual deadline depends on (`content_submission.published_at`, per ADR-0034) has not happened and cannot be predicted precisely: a creator might publish the day after accepting or weeks later, within whatever the campaign's own timeline allows. US-35a and US-35b, by contrast, describe "the deadline committed to Duda at acceptance" as if it is already a known, fixed quantity at that point. These two framings only hold together if "committed at acceptance" refers to the *window length* (a constant, known the moment ADR-0034 fixes it) while the *calendar date* shown pre-acceptance is necessarily an estimate, not yet pinned to a real publication date.

Two options were considered for what to show on `GET /creator-portal/opportunities` and the accept response:

- **Show nothing until publication.** This would satisfy FR-43 the least: the whole point of the story is that Duda sees the figure *before* she commits, not after.
- **Show a projected date, computed from data already available at opportunity-creation time, clearly labeled as an estimate.** This satisfies FR-43's letter (a specific date is shown) while being honest that it is not the number NFR-11 is measured against.

The second option needs a concrete source field to project from. `campaign_opportunity` itself carries no delivery-due-date field (only `expires_at`, the response deadline, and `deliverable`, a format/quantity/brief-reference object with no date). `campaign.timeline_end` (E2's existing field) is the campaign's own committed end date and is populated by the time a campaign reaches the `confirmed`/`active` states opportunities are created in -- except E2's own quote-required field set (section 3.3 of the E2 architecture document) does not include `timeline_end` as mandatory, so it can, in practice, still be null on an active campaign.

## Decision

`expected_payment_date = COALESCE(campaign.timeline_end, opportunity.expires_at) + PAYOUT_WINDOW_DAYS`, computed read-only, at request time, on `GET /creator-portal/opportunities` and `POST /creator-portal/opportunities/:id/accept` (section 4.2 of the E6 architecture document). The response carries a second field, `expected_payment_date_is_estimate: true`, always, on this surface -- there is no case before publication where this figure is anything other than a projection. The **binding** figure NFR-11 is actually measured against is computed separately and later, as `payout_obligation.committed_deadline_at = published_at + PAYOUT_WINDOW_DAYS`, fixed only once publication is actually confirmed (ADR-0034).

This is an architectural default filling a gap neither FR-43 nor the stories document resolves (PRD open question 1's own framing: "the acceptance criteria above treat 'the committed window' as a known, already-displayed value at acceptance time, without assuming its length"), in the same spirit as ADR-0019's and ADR-0030's precedent of filling a product gap because backend-dev needs one concrete rule to build against, not as a substitute for product confirming the behavior later.

## Consequences

**What Aurora gains:**
- FR-43 is satisfied literally: a specific date is shown, before any commitment, computed from data that already exists at that moment, with no new field needed on `campaign` or `campaign_opportunity` and no change to either table's existing schema or immutability guarantees (section 2.2 of the E6 architecture document).
- The `expected_payment_date_is_estimate` flag means the frontend is never forced to choose between hiding the date (failing FR-43) or presenting an estimate with the same visual certainty as the three locked, immutable payout figures beside it -- the distinction between "fixed now" and "projected" survives into the UI as data, not as a convention someone has to remember to apply.
- The fallback to `opportunity.expires_at` means this computation never fails or returns null, even for a campaign that happens to have no `timeline_end` set, at the cost of a less meaningful (earlier, tighter) estimate in that specific case -- a graceful degradation rather than an error state on a read-only, informational field.

**What Aurora gives up:**
- The projection can be wrong in either direction: a creator who publishes well before `campaign.timeline_end` will see a later date than what actually happens (a pleasant surprise); a creator who publishes near or after it will see an earlier date than what actually happens (an unpleasant one, though still bounded by the fact that the binding deadline is always computed fresh from the real `published_at`, never inherited from this estimate). This is an inherent property of estimating a date that depends on an event that has not happened yet, not a flaw specific to this formula.
- If `campaign.timeline_end` is frequently null in practice (since E2 does not require it for a quote), the fallback to `opportunity.expires_at` will be the common case rather than the exception, producing a systematically tighter-looking estimate than the campaign's real timeline would suggest. This is accepted as a pilot-scale approximation rather than a reason to add a new required field to E2's campaign-creation flow, which is out of this epic's scope to change.

**Risk:** A creator could reasonably expect the projected date to be the real one despite the `is_estimate` flag, if the frontend ever fails to render that distinction prominently -- this is a frontend-implementation risk this architecture document can name but not eliminate by schema alone. Mitigation: section 6 of the E6 architecture document calls out this route's WCAG 2.2 AA scope and the estimate-labeling requirement explicitly, as a design-review checklist item, the same discipline E5 applied to its own AA-scoped routes.
