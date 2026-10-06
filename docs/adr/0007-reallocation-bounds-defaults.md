# ADR-0007: Default Reallocation Bounds and the Floor on Creator Allocation

**Status:** Proposed
**Date:** 2026-10-05
**Epic:** E2 -- Campaign Planning and Pool Buying
**Governs:** US-10, FR-23

**Resolves PRD open question 1** (stories.md): "Reallocation bounds, who sets them and what the defaults are."

## Context

FR-23 requires that budget reallocation toward better-performing creators happens "within bounds configured by the buyer," but neither the PRD nor the functional requirement states a default bound, a minimum guaranteed share per creator, or whether a creator's allocation can be reduced to zero mid-campaign. The stories document flags this explicitly as needing a decision before build, since it affects the payout commitment made to creators at acceptance (FR-43/US-29 in E6): a creator who accepted an opportunity at a stated gross/net amount cannot have that amount arbitrarily erased by an algorithm optimizing for brand performance, or Aurora's core creator-facing promise (treating creators as customers, not anonymous supply) is broken by its own optimization feature.

Three options were considered:

- **No floor, reallocation can zero out any creator's remaining budget.** Maximizes responsiveness to performance data. Rejected: it directly contradicts the commitment made to a creator at acceptance (FR-43 shows them a gross/net amount before they accept) and the payment integrity principle underlying E6 (NFR-13), since "remaining budget" for a not-yet-published creator is still an amount they were told to expect.
- **Buyer-configured bounds with no system-enforced minimum or ceiling.** Lets the buyer set any percentage, including a floor of zero. Rejected for the same reason: giving the buyer the option to configure a creator's allocation to zero is the same underlying harm, just relocated to a configuration screen instead of an algorithm.
- **Buyer-configured bounds within a system-enforced range, with reallocation opt-in by default and a floor that applies only to not-yet-committed amounts.** The buyer sets `max_shift_pct` (how much can move per cycle) and `min_guaranteed_share_pct` (the floor, as a percentage of the creator's original allocation) within ranges Aurora fixes. Already-committed (published, earned) amounts are structurally protected by the `committed_budget` database trigger from ADR-0005, independent of these bounds.

## Decision

Reallocation bounds are buyer-configured within system-enforced ranges, defaulting to conservative values, and reallocation is **opt-in**, not opt-out:

- `enabled`: defaults to `false` on campaign confirmation. The buyer must explicitly turn reallocation on via PUT /campaigns/:id/reallocation-bounds. This resolves the "who sets them" half of the open question in favor of the buyer having to make an active choice, rather than discovering after the fact that their budget moved.
- `max_shift_pct`: defaults to 20%, configurable in the range 0-30%. This bounds how much of a creator's *remaining* allocation can move away from them in a single reallocation cycle (every 6 hours, per the `reallocate-budget` job), preventing a single bad data point from causing a large swing.
- `min_guaranteed_share_pct`: defaults to 50%, configurable in the range 40-100%. A creator's remaining allocation can never be reduced below this percentage of their *original* allocation at pool assignment. A value of 100% is a valid buyer choice that effectively disables downward reallocation for that campaign while leaving upward reallocation (toward this creator, from others' surplus) possible.
- The floor applies only to the *remaining*, not-yet-committed portion. Once a creator publishes and `committed_budget` is set (per ADR-0005), that amount is immovable by reallocation regardless of these bounds -- the floor and the commit trigger are two independent protections, not one mechanism.
- A creator's remaining allocation can never be reduced to exactly zero while they have not yet published, even if `min_guaranteed_share_pct` combined with a large `max_shift_pct` would mathematically allow it; the reallocation algorithm clamps at the greater of the configured floor or a small non-zero minimum (R$ 50), so no creator who accepted an opportunity in good faith is ever told, mid-campaign, that their remaining allocation is nothing.

## Consequences

**What Aurora gains:**
- A documented, system-enforced floor that protects creators from having their accepted-opportunity payout erased by an algorithm, consistent with Aurora's strategic bet on treating creators as customers (business analysis, section 2.7) and with FR-43's commitment to show gross/net before acceptance.
- Opt-in by default means a buyer who never touches the reallocation feature gets the simple, predictable fixed-price experience US-07 promises, with no surprise budget movement.
- Bounded ranges (not unlimited buyer configuration) mean Aurora, not just the buyer, is answerable for the creator-protection floor, which matters for the legal/product review the stories document recommended before this feature ships.

**What Aurora gives up:**
- Buyers who want more aggressive optimization (e.g., a 0% floor to chase pure performance) cannot configure that; the ceiling at 40% minimum share is a deliberate limit on buyer control in favor of creator protection. This is a product-positioning tradeoff, not an oversight.
- The conservative defaults mean reallocation's visible effect is modest in a typical campaign, which may underwhelm a buyer expecting dramatic budget shifts. This is intentional: FR-23 is a "Should," not a "Must," and the feature's value is directional correctness, not maximum responsiveness.

**Risks:**
- These specific numbers (20%, 50%, 40-100% range, R$ 50 floor) are Aurora's working defaults in the absence of a formal product/legal decision, per the stories document's recommendation that this be resolved "with product/legal before build." They should be treated as the starting configuration to validate with the first pilot campaigns that enable reallocation, not as numbers carved in stone.
