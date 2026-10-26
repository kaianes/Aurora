# ADR-0043: Payout Failure Notification Behind a Dedicated Adapter, Decoupled From In-App Visibility

**Status:** Proposed
**Date:** 2026-10-21
**Epic:** E6 -- Payments and Financial Transparency
**Governs:** US-35c, FR-46

## Context

FR-46 requires notifying a creator "within 24 hours when a payout fails, state the reason, and keep the obligation visible as outstanding until settled." US-35c scenario 3 is explicit that these are two separate guarantees, not one: "the obligation still appears, within her own payment history (US-36a), as owed with the stated failure reason, regardless of whether the outbound notification was successfully delivered -- visibility inside the product never depends solely on an external notification succeeding." This is structurally the same lesson `docs/architecture.md`'s own QAS-08 and S-08 already drew for a different external dependency ("payout not blocked by publication-link verification... a platform outage would otherwise mean unpaid creators") -- an external channel's unreliability must never be allowed to degrade a guarantee the product makes independently of that channel.

This codebase already has a precedent for *not* widening an existing adapter to serve a second, differently-risk-toleranced purpose: ADR-0031 explicitly declined to reuse E4's `LiveContentFetcher` for E5's publication-link gate, reasoning that "widening `LiveContentFetcher`'s contract or its guarantees to serve a gate would risk weakening the monitoring job's own simplicity." The same reasoning applies here: `content-workflow`'s existing `BriefingNotificationAdapter` (E5) exists to deliver a one-time broadcast about a briefing, with no SLA and no distinction between in-app visibility and delivery success (a missed briefing notification does not strand any data -- the briefing is still readable in-app regardless). A payout-failure notification carries a 24-hour regulatory-feeling SLA (FR-46's own wording) and a stated reason that must be visible in-app whether or not delivery succeeds -- different enough risk tolerance that reusing or widening `BriefingNotificationAdapter` would risk exactly the coupling ADR-0031 already rejected in the analogous case.

## Decision

E6 defines `PayoutNotificationAdapter`, exported by the `payments` module and consumed by exactly one thing: the `notify-payout-failure` job (section 5 of the E6 architecture document).

```typescript
interface PayoutNotificationAdapter {
  notifyFailure(input: {
    creatorId: string;
    payoutObligationId: string;
    reason: string;
  }): Promise<{ delivered: boolean }>;
}
```

The adapter's return value is informational only -- `payout_obligation.failure_notification_sent_at` is set to the time the attempt was made, regardless of `delivered`'s value, and no code path anywhere in this epic conditions the obligation's in-app visibility (its `status`, `last_failure_reason`, or its appearance in US-36a's payment history) on this adapter's outcome. The pilot ships `StubPayoutNotificationAdapter`, which always returns `{ delivered: true }` without making any real call, mirroring the same stub-always-succeeds precedent `StubBriefingNotificationAdapter` and `StubPublicationLinkVerifierAdapter` already established for their respective concerns. A real implementation would call the platform's existing notification provider (already named in `docs/architecture.md`'s context view, section 2.2) via whatever channel a creator has on file, exactly the same integration point `BriefingNotificationAdapter`'s own real implementation would use -- the two adapters can share a transport without sharing a contract, since nothing about `PayoutNotificationAdapter`'s interface depends on how delivery actually happens.

## Consequences

**What Aurora gains:**
- FR-46's two guarantees are structurally independent: a notification-provider outage can never cause a payout failure to "quietly disappear" (US-35c scenario 1's exact framing), because disappearance is prevented by the `payout_obligation` row's own durable state, not by the notification succeeding.
- `payments` and `content-workflow` can each evolve their own notification mechanics independently -- a future change to how briefings are delivered never risks loosening the payout-failure SLA, and vice versa, the same independence ADR-0031 already secured between E4's monitoring fetcher and E5's publication gate.
- The adapter boundary is consistent with this platform's now well-established discipline (`docs/architecture.md` section 2.1, extended by ADR-0021 and ADR-0031) of one narrow adapter per concern, rather than one shared "send a notification" interface accumulating every caller's different tolerance for being wrong.

**What Aurora gives up:**
- A third notification-adapter interface now exists in this codebase alongside `BriefingNotificationAdapter`, solving a structurally similar "deliver a message to a creator" problem with a different contract. A future engineer could reasonably ask why they are not the same thing; this ADR is the answer, and it holds as long as one carries a stated SLA with an in-app visibility guarantee independent of delivery and the other does not.
- The `delivered: true` stub means a pilot demo cannot distinguish "the notification was actually sent" from "the stub always claims success" -- acceptable because, as with every other stub in this codebase, the in-app guarantee (what the stub cannot fake) is the one FR-46 actually depends on.

**Risk:** A real implementation's own failure mode (the notification provider is down, a creator's contact channel bounces) is exactly the scenario US-35c scenario 3 anticipates, and this design's answer is "it does not matter to the in-app guarantee" -- but it does mean a creator could, in the worst case, never actually learn about a failure through this channel at all, relying entirely on their own initiative to check their payment history. Mitigation: none beyond what FR-46 itself states (visibility inside the product, not a guaranteed-delivered notification) -- this is the literal, accepted shape of the requirement as written, not a gap this design introduces.
