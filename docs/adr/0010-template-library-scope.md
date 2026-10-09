# ADR-0010: Campaign Template Library Scope -- Account-Level, Not User-Private

**Status:** Proposed
**Date:** 2026-10-05
**Epic:** E2 -- Campaign Planning and Pool Buying
**Governs:** US-08, FR-22

**Resolves PRD open question 4** (stories.md): "Template library scope (US-08)."

## Context

US-08 lets a buyer save a campaign as a reusable template and instantiate it later. The stories document notes it is unspecified whether templates are private to the creating user, shared across the whole brand workspace, or something in between for a single-account (non-agency) workspace. FR-22 separately covers agency cross-client template sharing (US-41), explicitly scoped to E9, so this decision is only about the single-account case: does a template created by `brand_manager` Maria show up for `brand_owner` Marina, and vice versa?

Three options were considered:

- **User-private.** Each template is visible only to the user who created it. Simplest permission model, but contradicts the collaborative intent of E1's team invitation feature (US-04): a brand workspace exists precisely so a team shares infrastructure like brand profiles and (by the same logic) campaign structures. A user-private template library would mean a new team member re-creates the same template their colleague already built, which is the exact coordination cost E2 exists to remove (per the epic's "Friction it removes" framing in the PRD's Table 1).
- **Account-level (shared across all members of the account with campaign rights).** Any user who can create a campaign in that account can see and instantiate any template saved in that account. Matches how the brand profile (E1) and campaign list already work: account-scoped, not user-scoped, consistent with the existing RLS and permission model (nothing new needs to be built).
- **Role-gated sharing (e.g., only owners can share, managers see only their own).** Introduces a visibility dimension beyond the existing role table, with no story or functional requirement motivating it. Rejected as unnecessary complexity for a problem the stories do not describe.

## Decision

Campaign templates are scoped to the **account**, visible to and instantiable by any member of that account who holds campaign-creation rights (the same role set as campaign creation in section 2.3 of the architecture document: `brand_owner`, `brand_manager`, `agency_admin`, `agency_operator` with client access). There is no user-private visibility tier. For agency workspaces, a template created while operating on behalf of a specific client account is scoped to that client account, not to the agency's home account or to other clients -- cross-client sharing remains out of scope here and is explicitly deferred to FR-22/US-41 in E9, consistent with how the stories document frames that boundary.

This requires no new permission concept: `campaign_template` uses the same RLS pattern (`account_id`-scoped) and the same role checks already defined for campaign creation, so there is nothing new for backend-dev to build beyond the table itself.

## Consequences

**What Aurora gains:**
- Consistency with every other account-scoped resource in the system (brand profile, campaigns, invitations), so there is one mental model of "what does account-scoping mean here" across the whole product, not a special case for templates.
- Delivers the actual value US-08 promises ("recurring campaigns take minutes instead of days") to the whole team, not just the one person who happened to save the template, which matters for a small brand team of 2-3 people (E1's `max_client_accounts`-adjacent team size assumption) where work is routinely handed off between a manager and an analyst-adjacent role.
- No new permission model to design, test, or explain to users; it reuses E1's existing role table unchanged.

**What Aurora gives up:**
- A user who wants a personal, private scratch template (e.g., drafting an experimental structure they are not ready to share with the team) has no way to do that; every saved template is immediately visible to the whole account. This is a minor loss of privacy within a team that otherwise already shares a brand profile and campaign list.
- If an agency later wants finer-grained control (e.g., some operators see only some templates within a client account), that is not supported today; it would require extending the `operator_client_access` pattern to templates specifically, which is not called for by any current story.

**Risks:**
- If E9's cross-client template sharing (US-41) is designed without reference to this decision, there is a risk of two incompatible sharing models (per-account here, per-workspace there) colliding. This ADR should be read alongside whatever E9's architecture document decides for US-41, and the E9 architect should treat account-scoping as the floor they are extending, not replacing.
