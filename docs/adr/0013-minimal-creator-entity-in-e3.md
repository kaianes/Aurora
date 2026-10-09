# ADR-0013: A Minimal `creator` Entity Is Introduced in E3, Owned Long-Term by E8

**Status:** Proposed
**Date:** 2026-10-05
**Epic:** E3 -- Creator Matching and Curation
**Governs:** US-11, US-12, US-28, FR-25, FR-26, NFR-29 (schema stability)

## Context

E3's stories all assume creators already exist with audience metrics, authenticity scores, and a qualification state: "eligible creators meeting at least the guaranteed minimum" (US-11), "audience size, demographic composition, engagement rate... authenticity score" (US-12), "approved onto a campaign's shortlist... receives an opportunity" (US-28). None of that exists in the codebase today. The PRD assigns creator onboarding, social account linking, metric computation, and the claim/unclaim lifecycle to M2 (Creator Network and Profiles), which this project's epic sequencing maps to E8, not E3. E3 cannot ship without creator rows to match against, approve, or send opportunities to, but building E8's full scope inside E3 would mean redoing work when E8 ships and risks the two epics disagreeing about the schema's shape.

Two options were considered:

- **Wait for E8**, blocking E3 entirely until creator onboarding exists. Rejected outright: it inverts the dependency the PRD actually states (M2 feeds M4; E3's own stories document says explicitly "FR-09 and FR-10 are produced by M2... this story specifies how those metrics surface in the matching context, not how they are computed"), and it would stall a Must-priority epic behind a later one in the build sequence.
- **E3 defines a minimal `creator` table sized exactly to what matching, approval, exclusion, and opportunity delivery need**, with every field E8 will eventually drive (claim status, social links, media kit, rate preferences) either absent or represented as a single nullable/placeholder column that E8 extends rather than migrates away from.

## Decision

E3 creates the `creator` table (section 2.2 of the E3 architecture doc) with exactly: identity (`id`, nullable `user_id`), display name, lifecycle status (`unclaimed | active | suspended`), onboarding qualification (`qualified | not_qualified | pending`), and the metrics fields US-12 needs (audience size, demographics, engagement rate, niche, authenticity score, staleness tracking). For the pilot, rows are seeded through a manual/scripted process outside any epic's user-facing scope (there is no self-registration flow yet since that is US-24/E8), with `status = active` and `onboarding_status = qualified` by default, so E3's flows are testable end to end.

When E8 ships, it **extends** this table (adds columns for social account links, media kit data, rate preferences, and the unclaimed-profile lifecycle from US-23/FR-12/FR-13) rather than replacing it. `user_id` is nullable today specifically so E8's claim flow can populate it later without a type change. `status = unclaimed` is reserved in the enum today, unused by E3 (nothing in E3 creates unclaimed profiles), so E8's FR-12 obligations slot into the existing column rather than requiring a new one.

## Consequences

**What Aurora gains:**
- E3 is unblocked and testable without waiting on E8, correctly reflecting the PRD's own dependency direction.
- E8 inherits a schema it can grow instead of migrate around: the costly parts (claim lifecycle, social links, media kits) are additive columns, not a redesign of the identity/status core that E3, the shortlist, exclusions, and opportunities already depend on.
- The nullable `user_id` and reserved `unclaimed` status value mean E8's eventual FR-12/FR-13 implementation (unclaimed profiles invisible to brands, deletable on refusal) does not require retrofitting every table that already has a foreign key to `creator` (shortlist entries, exclusions, opportunities) -- those tables reference `creator_id`, which is stable regardless of claim status.

**What Aurora gives up:**
- E3 ships with manually seeded creator data rather than a real network, which is an honest pilot-scoped limitation, not a hidden one -- it is stated plainly in the architecture doc and does not block demoing or testing US-11 through US-28 against seeded rows.
- There is a coordination cost: whoever builds E8 must read this ADR and the `creator` table's current shape before extending it, rather than designing M2 in a vacuum. This is a one-time cost paid at E8's kickoff, not an ongoing one.
- If E8's eventual design needs a genuinely incompatible change to the identity/status core (unlikely, given how narrowly E3 scoped it, but possible), a migration would be needed after all. The risk is judged low because E3 deliberately took the smallest possible slice of M2's concerns.
