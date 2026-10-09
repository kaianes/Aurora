# ADR-0009: Campaign Minimum Budget Threshold

**Status:** Proposed
**Date:** 2026-10-05
**Epic:** E2 -- Campaign Planning and Pool Buying
**Governs:** US-05, FR-16

**Resolves PRD open question 2** (stories.md): "Campaign minimum budget threshold (US-05, scenario 3)."

## Context

US-05 scenario 3 requires the system to reject a campaign save when "Marina enters a budget below the platform's minimum campaign size," stating the specific reason. Neither the PRD nor any functional requirement states what that minimum is; the stories document records this as a business decision that needs to be made, not guessed.

A minimum is structurally necessary for the fixed-price pool model (US-07) to work at all: if the budget is too small, there is no price point at which Aurora can guarantee a non-trivial minimum pool size (FR-17) while still paying creators a fair rate and covering platform costs (NFR-33's mid-market cost-efficiency target). Setting the number requires balancing three references already in the requirements:

- The brand plan's platform fee is R$ 497/month (E1 pricing, `docs/architecture/e1-access-onboarding.md` section 3.3), implying the platform expects each account to run enough campaign volume to justify that fee.
- The commission model is 15% (brand) or 12% (agency) of the amount paid to creators (same pricing source), meaning Aurora's revenue per campaign scales with campaign budget; a very small campaign generates a commission too small to cover the fixed cost of running a quote, a brand-safety pass, and a payout cycle for even a handful of creators.
- NFR-06 requires support up to 150 creators per campaign; a credible minimum should at least support a *meaningfully sized* pool (not just one or two creators), so the fixed-price promise (US-07) delivers something closer to a media buy than a single influencer negotiation.

## Decision

The platform-wide minimum campaign budget is **R$ 2,000.00**, enforced as a database constraint (`chk_campaign_minimum_budget`) on the `campaign.budget_amount` column, applied uniformly across brand and agency workspaces for the pilot.

The reasoning: at a working assumption of roughly R$ 150-300 average all-in cost per nano/micro creator deliverable (consistent with a mid-market, nano/micro-creator focused platform per the business analysis), R$ 2,000 supports a guaranteed minimum pool in the range of 7-13 creators, which is enough to feel like a pool rather than a single relationship, while remaining reachable for a brand media manager testing the platform for the first time (consistent with E1's mid-market, no-sales-call entry point). It is a single flat number, not tiered by workspace type, because the stories document gives no basis for a brand/agency split and introducing one without a stated reason would be guessing in a different place.

## Consequences

**What Aurora gains:**
- A concrete, enforceable rule that makes US-05 scenario 3 testable (QA can submit R$ 1,999 and expect a 422), closing a gap the PRD left open.
- A database-level constraint, not just an application check, so the rule holds even if a future code path bypasses the service layer (e.g., a data migration or an admin tool).
- A number low enough not to gate out the mid-market buyer Aurora is built for, while high enough that the guaranteed minimum pool is not trivially small.

**What Aurora gives up:**
- This number has no basis in actual pilot cost data yet (no campaigns have run); it is a reasoned estimate, not a measured one, and should be revisited after the first handful of real quotes come back from the matching engine (even the stub one) with actual per-creator cost assumptions.
- A flat minimum does not account for geography- or niche-specific cost variance (a very narrow luxury niche might need a higher floor to guarantee any meaningful pool at all); this is deferred to the per-quote "no viable pool" response (US-06 scenario 2) rather than a static minimum, which already handles that case architecturally.

**Risks:**
- If R$ 2,000 proves too high (blocking legitimate small test campaigns) or too low (producing quotes with guarantees of 1-2 creators that undermine the "pool" promise) during the pilot, the fix is a single constraint migration, not a design change, since the architecture already treats this as a configurable floor rather than a hardcoded assumption baked into the quote logic itself.
