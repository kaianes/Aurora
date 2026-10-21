# ADR-0020: A Minimal `content_submission` Entity, Owned by E4 Only Until E5 Ships

**Status:** Proposed
**Date:** 2026-10-20
**Epic:** E4 -- Brand Safety
**Governs:** US-16, FR-32, FR-33

## Context

`docs/architecture.md`'s top-level data model already names a `SUBMISSION` entity, owned conceptually by M6 (Content Workflow / E5): it carries `CREATOR ||--o{ OPPORTUNITY : receives`, `OPPORTUNITY ||--o{ SUBMISSION : produces`, and `SUBMISSION ||--o{ SAFETY_VERDICT : evaluated_by`. E5 (FR-39: "accept content drafts from creators and retain every submitted version") is the epic that will build the real thing -- draft versions, a review/approval cycle, rejection reasons (FR-40), and the publication-confirmation action (FR-42, FR-34's sibling in E5). E5 has not shipped yet, and under this build's sequencing it ships after E4.

E4 cannot implement US-16 (message-level check before publication) without something to check -- a row representing "this caption, this on-screen text, this audio, submitted for this campaign by this creator." Two options:

- **Wait for E5 and build nothing until then.** Rejected outright: US-16 and US-17 are both Must-priority stories in this epic, and the stories document and PRD both describe them as buildable and testable now, with E5's full workflow arriving later. Blocking this epic on a later one inverts the build order the task explicitly set.
- **Define a minimal entity now, scoped to exactly what the safety pipeline needs, explicitly designed for E5 to extend rather than conflict with.** This is the same move E3 made for `creator` ahead of E8 (ADR-0013): E3 needed somewhere to anchor scores, shortlists, and opportunities before the creator network module existed, so it shipped the smallest `creator` schema that satisfied its own needs and said plainly that E8 would extend it, not replace it.

## Decision

E4 defines `content_submission` (section 2.2 of the E4 architecture document) with exactly the fields the safety pipeline needs: `campaign_id`, `creator_id` (nullable, references E3's `creator`), `opportunity_id` (nullable, references E3's `campaign_opportunity`), `caption_text`, `on_screen_text`, `audio_transcript`, `media_asset_url`, `extraction_status`, and timestamps. It does **not** attempt to model draft versioning, a review/approval state machine, or a rejection-reason field -- all of that is FR-39/FR-40's scope and belongs to E5's eventual `submission` table.

Rows are created today by one creator-portal intake endpoint (`POST /creator-portal/content-submissions`), built only far enough to make US-16 testable end-to-end before E5 exists -- the same scope-limiting move E3 made with its own stubbed creator-login endpoint ahead of E8. When E5 ships FR-39, its draft-submission code is expected to populate `content_submission` (directly, or via `brand-safety`'s exported service, not HTTP, since both modules live in the same deployable per `docs/architecture.md` section 2.1) as part of accepting a draft, rather than E4's stub endpoint continuing to be the only way content reaches a check.

## Consequences

**What Aurora gains:**
- US-16 and US-17 are buildable and demonstrable now, against a real (if minimal) data model, without inventing a parallel, throwaway representation of "content to check" that would need to be migrated away later.
- The shape chosen is deliberately close to what `docs/architecture.md`'s own `SUBMISSION` entity implies (a thing with campaign/creator/opportunity context and content to evaluate), so E5 extending it -- adding version history, a review state machine, rejection reasons -- is additive, not a redesign. This mirrors ADR-0013's precedent exactly and for the same reason: a later epic's real entity should recognize an earlier epic's minimal one as an ancestor, not a conflicting parallel structure.
- The one HTTP endpoint this ADR authorizes is explicitly scoped as a gap-filler, which keeps E4 from accidentally becoming the epic that builds half of E5's workflow by accretion.

**What Aurora gives up:**
- A submission in this epic has no version history -- resubmitting content after a `revision_requested` decision (US-17) creates a *new* `content_submission` row with no link back to the one it supersedes, because that linkage is exactly the kind of workflow state FR-39 owns and this epic deliberately does not build. E5 will need to decide how its version history relates to the `content_submission` rows this epic already created, which is a known, named seam rather than a silent gap.
- The stub intake endpoint's authentication and request shape are an architectural guess at what a creator-submission flow looks like before E5 exists to specify it for real. If E5's eventual structured draft form needs materially different fields, this endpoint is replaced, not migrated -- it was never meant to be the long-term contract.

**Risk:** If E5's build is delayed significantly past E4's, the stub endpoint could calcify into a de facto production path for submitting content, well beyond its intended gap-filling scope. Mitigation: this ADR and the architecture document both state explicitly that `BrandSafetyGateService`'s two methods, not this HTTP endpoint, are the contract a future E5 architecture should build against.
