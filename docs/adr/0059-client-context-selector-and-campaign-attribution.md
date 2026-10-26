# ADR-0059: Client-Context Selector and Campaign Attribution Reuse Existing Account-Switch Plumbing -- No New Authorization Mechanism

**Status:** Proposed
**Date:** 2026-10-21
**Epic:** E9 -- Agency Multi-Client Operations
**Governs:** US-39, FR-24

## Context

US-39 asks for Renata to "run campaigns on behalf of a specific client, so that every campaign is attributed to the right account." The stories document, having checked the actual codebase rather than assumed from the PRD, found that the *authorization* half of this is already fully built and already load-bearing: `RolesGuard` resolves `currentAccountId` from `X-Account-Id` through `AccountAccessService.resolveAccess`, which already handles the agency-acting-on-a-client-account case explicitly (the guard's own code comment names it), and `campaign.service.ts` already stores that resolved account as the campaign's `account_id` on every create. What the stories document found missing, checked against the actual frontend code: no route anywhere gives Renata an *explicit* selector, and no campaign view shows which client a campaign belongs to.

Checking the frontend before designing (per this epic's own task instructions) found the gap is narrower than "build a client-context mechanism from nothing." `frontend/src/components/layout/app-layout.tsx` already renders an account switcher -- a bare `<select>` populated from `workspace.accounts`, calling an existing `switchAccount(accountId)` in `auth-context.tsx`, which calls the existing `setCurrentAccountId`/`refreshWorkspace`. This is the exact mechanism E7 already relies on for its own agency surfaces (`client-report-page.tsx` explicitly switches account context around its report calls, then restores it). What does not exist: the switcher does not distinguish the agency's own home account from its clients in the list (a flat, unlabeled set of options), there is no persistent indication elsewhere in the UI of which kind of account is currently active, and neither `campaigns-page.tsx` nor `campaign-detail-page.tsx` renders any account attribution on a campaign at all -- confirmed by reading both files directly; `CampaignSummary`'s only fields are `id`, `name`, `state`, `budget_amount`, `created_at`.

Three options were considered for closing this gap:

- **Build a new, separate "act as client" flow** (a distinct modal, confirmation step, or dedicated route) layered on top of the existing switcher, treating US-39 as requiring a qualitatively different interaction than "pick an account from a list." This would duplicate state (two sources of truth for "which account is active") and contradict the precedent this epic is supposed to follow (ADR-0013/ADR-0020/ADR-0048's "smallest slice of a later epic's scope," here inverted to "smallest slice of a UI gap already mostly closed by earlier work").
- **Extend the existing switcher and existing campaign views additively**, adding structure (grouping, a persistent banner) and a new response field (`account_name`) rather than a new mechanism. Reuses everything already built and tested; the remaining work is presentation, not plumbing.
- **Do nothing beyond what already exists**, arguing the flat selector already technically satisfies "select which client you are acting for." Rejected: the stories document's own scenario 1 requires that "every subsequent view of that campaign... clearly and persistently shows which client it belongs to," which the current campaign views do not do at all, regardless of how the switcher itself is presented.

## Decision

Extend, do not replace. Three additive changes, no new backend authorization code:

1. `GET /campaigns` and `GET /campaigns/:id` gain `account_id`/`account_name` fields, a plain join on an already-correct, already-stored column (`campaign.accountId`, populated by FR-24 since E2). This is a response-shape change only.
2. The existing account switcher in `AppLayout` groups its options into "Minha agencia" (the one home account) and "Clientes" (every other account), using a field (`is_home`) `GET /workspaces/current` already returns (E1). A persistent banner renders whenever the active account is not the home account, stating who Renata is currently acting for, visible on every subsequent screen in that session -- not a one-time toast, not a confirmation dialog, just a durable piece of layout state that reads directly from the same `workspace.current_account` the switcher itself already reads.
3. Campaign list, detail, and creation-form views render the new `account_name` field (or, on the creation form, a notice naming the currently-active account before the campaign is submitted), unconditionally across workspace types -- in a brand workspace this is simply always the one account's own name, which costs nothing to render and avoids forking the campaign views' code paths on workspace type.

No new RLS policy, no new escape hatch, no new role check. `RolesGuard`/`AccountAccessService.resolveAccess` already enforce exactly what US-39 scenario 3 requires (refuse a campaign-creation attempt against a client the caller cannot reach, log the denial) -- this ADR changes nothing about enforcement, only about whether a human can see what is already being enforced.

## Consequences

**What Aurora gains:**
- US-39's full acceptance criteria are satisfied without adding a second authorization pathway to audit or maintain alongside `RolesGuard`, which is the single mechanism every other epic's agency-scoped endpoint already depends on (E2 through E8). A second, parallel "client-context" concept would have been a second place NFR-16's "100% server-side authorization" promise could silently diverge from.
- The persistent banner directly closes the gap the stories document names most precisely: not that switching is hard, but that *nothing visible* tells Renata, mid-session, whose data she is looking at, which is exactly what US-38 scenario 2's "no stale total, no creator carried over" is already true of mechanically but was previously invisible to a user relying on memory alone.
- Reusing the exact account-switching code E7 already exercises (`client-report-page.tsx`) means this ADR introduces no new pattern for frontend-dev to learn; it is the same one, applied one level higher (global layout) instead of one page at a time.

**What Aurora gives up:**
- Nothing is gained in enforcement strength here -- a determined caller bypassing the UI entirely and hitting the API directly was already fully covered before this ADR, and remains exactly as covered after it. This ADR is purely a usability closure of an already-sound security boundary, which is the correct scope for a story whose own stories document states the hard part is already built.
- The account switcher remains a single global control, not a per-page context (e.g., no "view campaigns across all clients at once" list). That remains out of scope; nothing in US-39's acceptance criteria asks for a cross-client campaign view, and E7's `GET /agency/reports/compare` already exists for the one cross-client read this platform supports (US-46), which this ADR does not extend or duplicate.
