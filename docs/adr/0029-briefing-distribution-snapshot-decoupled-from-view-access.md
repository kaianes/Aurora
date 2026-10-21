# ADR-0029: Briefing Distribution Is a Point-in-Time Snapshot, Decoupled From Live View-Access Gating

**Status:** Proposed
**Date:** 2026-10-21
**Epic:** E5 -- Briefing and Content Workflow
**Governs:** US-18b, US-30, FR-37

## Context

US-18b asks that one send action reach "every creator in the pool," including scenario 2's explicit case of a pool "spanning creators approved at different points during matching... including some approved shortly before the briefing is sent." US-30 asks, separately, that a creator can view a briefing only while they have "an active opportunity" on the campaign (scenario 1's precondition), and explicitly refuses to show the briefing once that opportunity "was declined or has expired... before any briefing reached her" (scenario 3).

These two requirements pull in different directions if modeled as one fact. US-18b's "pool" is a statement about who the single send action reached, fixed at the moment of sending. US-30's "active opportunity" is a statement about a creator's *current* standing, which can change after the send (an opportunity Duda accepted last week could expire next week, or one she had not yet responded to at send time could later be declined). If the system recorded only one of these and inferred the other, at least one scenario would be wrong: inferring view access from the distribution record would let a creator whose opportunity later expired keep seeing a briefing meant only for active relationships (US-30 scenario 3's explicit refusal); inferring "who was reached" from current opportunity status would understate the send's own history the moment any recipient's status changed afterward, undermining US-18b's "states which specific creators the briefing failed to reach" guarantee as a historical record.

## Decision

Two independent facts are recorded and read independently (sections 3.2 and 4.2-4.3 of the E5 architecture document):

- **`briefing_distribution_recipient`**: a snapshot, written once at issue time, of every creator holding a `campaign_opportunity` for the campaign **at that moment**, regardless of that opportunity's own status, with a delivery outcome (`delivered` / `failed`) resolved shortly after by the fan-out job. This answers "who did the one send action reach" and never changes after the fact.
- **View access** (`GET /creator-portal/briefing`, US-30): computed live, on every request, by checking whether the requesting creator currently holds an `accepted` `campaign_opportunity` for the campaign -- a query against E3's existing `campaign_opportunity.status`, not against the distribution snapshot.

A creator can therefore appear in the distribution snapshot (the briefing was sent while they held an opportunity) and still be refused view access later (their opportunity has since expired or been declined), and conversely a creator whose opportunity was only accepted after the briefing was issued is covered by the distribution snapshot already (since recipients are resolved from every opportunity holder "at the moment of sending," which includes anyone newly approved right up to that instant, per US-18b scenario 2) while gaining view access the moment their own `accepted` status is set, independent of whether their individual delivery notification succeeded.

## Consequences

**What Aurora gains:**
- US-18b scenario 3's "reports which specific creators the briefing failed to reach" and US-30 scenario 3's "no briefing content for a campaign she has no active opportunity on" are both satisfied exactly as stated, because neither requirement is forced to borrow the other's data source.
- A creator never loses access to in-portal content merely because a push notification failed to deliver -- `briefing_distribution_recipient.status = failed` records a notification problem, not a content-access problem. The content itself is always independently reachable through the portal to any creator whose opportunity is currently accepted, which is a defense-in-depth property: Marina sees the delivery failure and can follow up, while Duda is never actually locked out of her own briefing by a notification-provider glitch.
- The distribution snapshot is immutable history (useful for an audit trail of exactly what happened at send time); view access is always current truth. Neither has to compromise to serve the other's purpose.

**What Aurora gives up:**
- Two queries, not one, are needed to answer "can this creator see this briefing, and did they get notified about it" -- a developer unfamiliar with this decision could reasonably expect one answer to imply the other. This ADR exists to make the split explicit rather than leaving it to be rediscovered from the schema.

**Risk:** None beyond the documentation risk named above.
