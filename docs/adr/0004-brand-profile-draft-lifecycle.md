# ADR-0004: Brand Profile Draft Lifecycle

**Status:** Proposed
**Date:** 2026-09-25
**Epic:** E1 -- Access and Onboarding
**Governs:** US-03, FR-03

## Context

US-03 requires that a brand profile can be saved as a draft when the user does not have all information ready (scenario 2). The resolved questions state that campaigns can be created against a draft profile, but the system should warn that defaults may be incomplete.

The decision to make here is how to represent "draft" versus "complete" and whether the profile has a more complex lifecycle (versioning, approval, publishing).

Three options were considered:

- **Two-state model (draft / complete).** The profile is always editable. Status is computed from the data: if all fields are filled, it is complete; otherwise, draft. No approval step, no versioning. The simplest model, and it matches what US-03 describes: Marina fills in what she has, saves, and comes back later.

- **Published/unpublished with versioning.** Each save creates a new version. A "publish" action makes the current version the one campaigns inherit from. This adds a layer of control but also a layer of complexity that nothing in E1 requires. Versioning becomes relevant when brand safety rulesets need audit history (FR-31), but that is E4's scope, not E1's.

- **Approval workflow.** A draft must be approved (by another team member or by an admin) before it takes effect. Nothing in the stories or functional requirements calls for this. It would add friction to onboarding, which contradicts the epic's goal of removing entry barriers.

## Decision

The brand profile uses a two-state model: `draft` and `complete`. The status is computed, not manually set.

- **Draft**: the profile has a `name` (required at creation) but one or more optional fields (`logo_url`, `tone_of_voice`, `content_guidelines`, `prohibited_topics`) are null or empty.
- **Complete**: all five fields are non-null and non-empty.
- The profile is always editable, regardless of status. There is no "lock" or "publish" action.
- Campaigns can be created against a draft profile. When they are, the campaign creation response includes a warning: `"brand_profile_status": "draft"` and a message explaining that some defaults may be missing.
- The profile is stored as a single mutable row (one per account). Edits overwrite the previous values. There is no version history at E1 scope.

## Consequences

**What Aurora gains:**
- Minimal friction. Marina can start a profile with just a name and come back to fill in the rest. No workflow gates, no approval steps, no versioning overhead.
- The "draft" indicator is useful UX feedback without being a blocker. The frontend can show a completeness bar or a checklist.
- Simplicity for backend-dev: one table, one row per account, standard CRUD.

**What Aurora gives up:**
- No edit history. If Marina overwrites her tone-of-voice description, the old one is gone. This is acceptable at E1 scope. If E4 (Brand Safety) needs to audit when a safety ruleset changed, the `safety_ruleset` entity (which is separate from the brand profile) will carry its own versioning.
- No approval gate. If a team member with `brand_manager` role makes a bad edit, there is no review step. Mitigation: the audit log records `brand_profile.updated` with the acting user, so the change is attributable even if it is not approvable.

**Risks:**
- A future epic may need profile versioning (for example, to show which version of the guidelines a campaign inherited). If so, the migration path is to add a `brand_profile_version` table and populate it from the audit log's metadata. This is straightforward but should be planned if E4 or E5 requires it.
