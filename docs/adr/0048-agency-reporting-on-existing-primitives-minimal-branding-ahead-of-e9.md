# ADR-0048: US-43 and US-46 Built Against Existing Workspace/Account/Operator-Access Primitives, With One Minimal `agency_branding_profile` Entity Introduced Ahead of E9

**Status:** Proposed
**Date:** 2026-10-21
**Epic:** E7 -- Analytics and Reporting
**Governs:** US-43, US-46, FR-55, FR-56, FR-57 (partial), NFR-16

## Context

The stories document flags US-43 (per-client reports under the agency's own branding) and US-46 (compare performance across clients) as depending on "E9 entities that do not yet exist in any stories or architecture document" -- specifically, "the client-account structure itself (US-38, US-39, FR-06, FR-07) belong to E9." This epic's own task description names the precedent to follow: ADR-0013 (E3's minimal `creator` entity, built ahead of E8) and ADR-0020 (E5's minimal `content_submission` entity, built ahead of E5's own later extension), either scoping the two stories down to what genuinely exists today, or building a minimal placeholder entity sized to exactly what is needed.

Before applying either option, the actual codebase was checked rather than assumed -- and the check changes the shape of this decision. **FR-06 and FR-07 are not unbuilt E9 scope at all; they are already-shipped E1 scope.** `backend/src/database/entities/workspace.entity.ts` (`type: brand | agency`, `maxClientAccounts`), `account.entity.ts` (`workspaceId`), and `operator-client-access.entity.ts` (`membershipId`, `accountId`) together already implement exactly the structure FR-06 ("a brand workspace containing one account, and an agency workspace containing multiple client accounts") and FR-07 ("isolate campaign, creator, content, and financial data between client accounts") describe. `backend/src/agency/agency.service.ts` already uses this structure in production code today: `listClients` already scopes an `agency_operator`'s visible client accounts to exactly the ones named in their `operator_client_access` rows, and every campaign-scoped endpoint across E2 through E6 already reads `account_id` as either a brand's own account or one specific agency client account, with no schema difference between the two (E6's own ADR-0040 states this explicitly for `invoice`). The stories document's framing -- written without re-checking the implemented codebase against the PRD's epic boundaries -- conflates "the user-facing *workflows* named US-38/US-39 have not been built" (true; there is no onboarding wizard, no "create a client" UI flow beyond the one bare endpoint `POST /agency/clients` already supports) with "the underlying *data structure* those workflows would operate on does not exist" (false; it has existed, and been load-bearing, since E1).

What genuinely does not exist anywhere in the codebase is **FR-57's branding configuration** (logo, colors, domain) -- no table, no column, no endpoint carries any of it. This is the one real gap standing between US-43 and a fully isolated, fully buildable per-client report.

Two structurally different resolutions follow from this, one per story:

- **For US-46** (cross-client comparison): no new entity is needed at all. The comparison is a read across multiple already-isolated `account_id`s within one already-modeled `workspace_id`, respecting already-enforced `operator_client_access` grants. The only genuinely new piece of work is a query that spans more than one tenant context in a single request, which is an RLS mechanism question (resolved in section 2.5 of the E7 architecture document), not an entity question.
- **For US-43** (branded reports): the report-isolation half is, likewise, already fully buildable on existing primitives. The branding half has nothing to build against. Two options were weighed for this one remaining piece: scope the story down to "isolated per-client reports, rendered with a neutral, unbranded template, with an explicit note that agency branding awaits E9," or introduce a minimal, narrowly-scoped `agency_branding_profile` entity now, sized to exactly the two visual properties (logo, colors) a rendered PDF/CSV needs, following ADR-0013's and ADR-0020's exact precedent of taking the smallest slice of a later epic's scope rather than either the whole of it or none of it.

## Decision

**US-46 requires no new entity and no scope reduction.** `GET /agency/reports/compare` (section 5.6 of the E7 architecture document) is built fully, against `workspace`, `account`, and `operator_client_access` as they already exist, plus a new, narrow RLS escape hatch (`app.agency_cross_client_read`, section 2.5) that lets one request read `campaign_performance_aggregate` rows across several already-validated client accounts in the caller's own workspace -- the third instance of the session-flag-plus-application-filter pattern this codebase already established with `app.creator_portal` (E3) and `app.aurora_operator` (E6). US-46 scenario 3's isolation requirement (refuse, do not silently drop, a client outside the caller's access) is enforced the same way E1's existing `operator_client_access` check already enforces it everywhere else this codebase reads client-scoped data.

**US-43 is built fully for everything except branding, which is filled with a minimal, E9-owned-long-term entity.** This epic adds exactly:

```sql
CREATE TABLE agency_branding_profile (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL UNIQUE REFERENCES workspace(id),
  logo_url text NULL,
  primary_color_hex text NULL,
  secondary_color_hex text NULL,
  updated_by_user_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

sized to exactly the visual properties a rendered report needs -- no domain field (custom-domain routing is an infrastructure concern FR-57 also names, entirely out of this epic's scope and genuinely E9's to build), no client-facing white-label surface configuration (US-44's own scope), no configuration UI beyond one minimal form this epic's frontend route map names explicitly (`/agency/branding`). This table lives in the existing `agency` module, additively, not in `analytics` -- the same "extend an existing module minimally, owned long-term by whichever epic owns that domain" discipline E6 already applied to `creator.tax_id` (ADR-0013's own precedent, reused a second time). When E9 ships, it extends this table (domain, additional white-label fields) rather than replacing it, exactly as ADR-0013 forecast for `creator` and exactly as has since held true.

**The unbranded fallback** (when `agency_branding_profile` does not exist for a workspace, or exists with every field `null`) renders with a neutral, agency- and Aurora-agnostic template -- resolving the stories document's own open question 6 ("no fallback is specified... whether an unbranded client report falls back to a neutral template or to Aurora's own branding") in favor of neutral, since defaulting to Aurora's own branding would directly contradict US-43's stated purpose ("I deliver them as my agency's work").

**This is an architecture decision bridging a gap, not an invented product requirement.** Nothing here decides what E9's eventual branding configuration UI looks like, what a custom domain does, or how US-44's white-label client-facing surface is built -- those remain entirely E9's to specify. This document only states what US-43's one report-rendering need requires from that eventual structure, the same restraint ADR-0013 and ADR-0020 already exercised for their own later epics.

## Consequences

**What Aurora gains:**
- US-46 ships as a Could-priority story fully, not as a scoped-down version of itself -- the forward dependency the stories document names turns out, on inspection of the real codebase, not to block it at all.
- US-43 ships with genuine, working branding (not a placeholder note saying "branding coming later") the moment any agency configures a logo and two colors, which is a materially better pilot experience than either blocking the story entirely or shipping it permanently unbranded.
- E9, when it arrives, inherits a schema it extends rather than migrates around -- the same low-friction hand-off ADR-0013 already demonstrated actually works in this codebase's history, not merely in theory.
- The RLS escape hatch introduced for US-46 (`app.agency_cross_client_read`) is narrower in blast radius than `app.aurora_operator`'s unrestricted cross-tenant reach, since it is gated on the caller's own workspace and still requires the service layer's own `operator_client_access` check before the flag is ever set -- a more conservative instance of an already-reviewed pattern, not a new category of risk.

**What Aurora gives up:**
- A coordination cost falls on whoever builds E9: they must read this ADR and `agency_branding_profile`'s current shape before extending it, the same one-time cost ADR-0013 already named for E8's eventual read of `creator`.
- `agency_branding_profile` is deliberately thin -- no domain, no multi-asset theming -- so if E9's actual branding needs turn out to require a structurally different shape (for example, per-client rather than per-workspace branding, which FR-57's wording does not rule out and this document does not resolve), a migration would be needed after all. The risk is judged low for the same reason ADR-0013 judged its own equivalent risk low: this epic deliberately took the smallest possible slice of FR-57's scope.

**Risk:** This document assumes FR-57's branding is workspace-level (one look per agency, applied to every client's report), not client-level (a different look per client, which some agencies serving visually distinct brands might actually want). Nothing in the PRD states which granularity is correct, and this document does not invent a decision the evidence does not support -- it is recorded here as an open assumption, the same posture ADR-0046 takes toward its own unvalidated formula choice, so that if E9 or product later states client-level branding is required, the gap is visible rather than discovered by surprise.
