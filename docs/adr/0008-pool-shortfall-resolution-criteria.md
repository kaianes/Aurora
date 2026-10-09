# ADR-0008: Criteria for Offering Partial Refund vs. Revised Guarantee on Pool Shortfall

**Status:** Proposed
**Date:** 2026-10-05
**Epic:** E2 -- Campaign Planning and Pool Buying
**Governs:** US-07, FR-19

**Resolves PRD open question 3** (stories.md): "Partial refund vs. revised guarantee split (US-07, FR-19)."

## Context

FR-19 requires that when the guaranteed minimum pool size cannot be filled by launch, the buyer is notified before launch and offered either a proportional refund or a revised (smaller) guarantee. Neither the PRD nor the functional requirement states the criteria for which option is offered, or whether the buyer chooses or Aurora decides. The stories document recommends this be clarified before the story is built.

This matters architecturally because US-07 scenario 3 requires the campaign to "never start short without warning," which means the resolution has to be in place and recorded *before* the `confirmed -> active` transition is allowed to fire (ADR-0006's state machine), and the resolution needs a stored, auditable decision, not an ephemeral notification.

Three options were considered:

- **Buyer always chooses between both options, every time.** Maximizes buyer control. Rejected as the sole rule: for a very small shortfall (a handful of creators short of a guarantee of e.g. 40), forcing a decision on the buyer every time adds friction for a difference that barely matters, and risks the buyer missing the notification window before launch (defeating the "never start short without warning" promise if the decision itself stalls the launch).
- **Aurora always decides, buyer is only informed.** Minimizes friction and guarantees a timely resolution. Rejected: it contradicts FR-19's explicit language that the buyer is "offered" a choice, not simply told an outcome; removing buyer agency entirely on a financial decision (how much to refund, or how much less they're guaranteed) does not fit a product built on predictable, media-like budgeting.
- **A threshold-based split: small shortfalls get a default resolution with no required choice (but disclosed and reversible within a short window); larger shortfalls require the buyer to actively choose.** Balances timeliness against buyer agency, scaling the decision's weight to the decision's size.

## Decision

The shortfall magnitude, measured as the percentage the actual matched pool falls short of `guaranteed_min_pool_size`, determines whether the buyer chooses or Aurora defaults:

- **Shortfall < 15% of the guaranteed minimum:** Aurora automatically applies a **revised guarantee** (the actual matched pool size becomes the new minimum, price unchanged) and notifies the buyer with the new number, recorded as `chosen_by: aurora_default`. The buyer can still override to a partial refund instead, via POST /campaigns/:id/shortfall/resolve, up until the campaign's `timeline_start`. This keeps the price/value ratio intact for the buyer (same price, slightly smaller but still real pool) without requiring action, while preserving their right to change it.
- **Shortfall ≥ 15% of the guaranteed minimum:** the buyer must actively choose between a **proportional partial refund** (refund amount = `locked_price * (shortfall_pct)`, rounded to the nearest real) and a **revised guarantee** (the smaller actual pool size, same price). The campaign does not transition to `active` until the buyer resolves this choice or the launch date passes with the default applied as a fallback (same default: revised guarantee, since an unresolved refund cannot be silently issued without consent on a financial transaction).
- In both cases, the notification fires via the `pool-fill-check` job (24 hours before `timeline_start`, per the architecture's job table), giving the buyer a window to decide or react before launch, satisfying "never starts short without warning."
- If the buyer takes no action by `timeline_start` in the large-shortfall case, Aurora applies the revised-guarantee default (not the refund default) and the campaign launches on schedule with the smaller pool, since launching late is a worse outcome for the buyer's media plan than launching slightly smaller, and a refund is a financial transaction that should not execute without affirmative consent.

## Consequences

**What Aurora gains:**
- Small, likely-inconsequential shortfalls resolve automatically without forcing a decision on the buyer, keeping the "never starts short without warning" promise satisfiable even if the buyer is unavailable in the 24-hour window.
- Large shortfalls preserve buyer agency over a real financial choice (give money back vs. accept less reach for the same money), consistent with FR-19's "offered" language.
- A clear, numeric threshold (15%) gives backend-dev an unambiguous rule to implement and QA an unambiguous scenario to test, rather than a vague "use judgment" instruction.
- No refund is ever issued without either explicit buyer choice or the buyer's inaction defaulting to a non-financial outcome (revised guarantee), which avoids an uncontrolled, consent-free money movement -- consistent with the payment integrity discipline E6 enforces downstream (NFR-13).

**What Aurora gives up:**
- The 15% threshold is a judgment call without a PRD or legal citation behind it, same caveat as ADR-0007: it is the pilot's working number, to be revisited once real shortfall cases accumulate.
- A buyer who would have preferred a refund for a small (<15%) shortfall must actively intervene to get it, rather than it being offered equally; this is an intentional default-to-least-friction choice, not an oversight.

**Risks:**
- If shortfall patterns in the pilot show that buyers frequently override the small-shortfall default, that is a signal the 15% threshold or the default direction (guarantee over refund) needs revisiting, and should be tracked as a product metric once E2 ships.
