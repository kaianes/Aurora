# ADR-0038: An `aurora_operator` Principal, Analogous to the Creator-Portal RLS Escape Hatch, for the Manual Payout Fallback

**Status:** Proposed
**Date:** 2026-10-21
**Epic:** E6 -- Payments and Financial Transparency
**Governs:** US-35b, US-35c, NFR-11, NFR-19

## Context

NFR-11 explicitly allows "any remainder resolved manually within the same window," and ADR-0033 commits this pilot to that manual path as the *only* way an obligation ever reaches `settled`, given that no live payment processor is integrated. Someone has to be able to call `POST /ops/payout-obligations/:id/mark-settled` and `mark-failed`. FR-04 names six roles -- brand owner, brand manager, brand analyst, creator, agency administrator, agency operator -- and none of them has any legitimate reason to approve a *creator's* payout: these are tenant roles, scoped to one brand's or one agency's own campaigns, while a stalled payout is Aurora's own financial operation, spanning every tenant's campaigns at once. PRD open question 3 names this gap directly: "no role is named for who may manually trigger a stalled payout, or approve/clear a failed one... nor whether it is an Aurora operations role outside FR-04's list entirely." `docs/architecture.md`'s own context view (section 2.2) already names "Aurora operations" as a fourth actor, distinct from Marina, Duda, and Renata, that the system supports rather than automates away -- but no prior epic has had to give that actor an actual authentication or authorization mechanism, because no prior epic needed one to act on data spanning every tenant.

Two structural options were considered:

- **Reuse an existing tenant role**, e.g. treat a `brand_owner` acting on their own campaign's obligations as sufficient. This fails immediately: a stalled payment on one brand's campaign is not that brand's decision to make, and a brand role has no legitimate reach into another tenant's campaigns at all, which is exactly what reconciliation and triage across the whole platform need.
- **Introduce a new, non-tenant-scoped principal**, structurally similar to the creator-portal actor E3 already introduced (no `account_id`, no `membership` row, let through RLS by a dedicated session flag rather than account-based policy).

## Decision

A new column, `user.is_aurora_operator` (boolean, default `false`), marks a user as holding this principal. It is **not** granted through any API this epic exposes -- no self-service request, no invitation flow, no role-assignment endpoint. It is set directly, the same way the pilot's `creator` rows are seeded outside any API surface (ADR-0013's precedent), because this is explicitly an internal operations mechanism, not a product feature any customer-facing role can grant to themselves or each other.

A new guard, `OperatorAuthGuard`, checks `is_aurora_operator = true` on the authenticated user and sets a new session flag, `app.aurora_operator = true`, on the database connection for the duration of the request -- structurally identical to how `TenantContextMiddleware` already sets `app.creator_portal` for a creator session. RLS policies on `payout_obligation`, `payout_execution_attempt`, and `ledger_entry` (section 3.7 of the E6 architecture document) add this flag as a third OR-branch alongside the account-scoped policy and the `app.creator_portal` branch, granting read access across every tenant's campaigns by design -- this is the one, narrow privilege this principal exists to carry.

`OperatorAuthGuard` additionally enforces E1's exact `MFA_REQUIRED_FOR_ROLE` check (section 3.7 of the E1 architecture document, already built for financial-privilege tenant roles) unconditionally for this principal: an operator without MFA enabled cannot call either manual-settlement endpoint, returning the same `MFA_REQUIRED_FOR_ROLE` error code E1 already defines. This is NFR-19's "mandatory MFA... for roles that can approve payouts," applied to the one principal in this platform that actually does.

**What this ADR explicitly does not decide:** who, specifically, is granted `is_aurora_operator`, whether granting it requires a second person's sign-off, whether it should be scoped more narrowly than "every payout obligation, platform-wide," or whether it should eventually become a seventh FR-04 role with its own invitation flow. PRD open question 3 is left exactly as open as the stories document framed it -- this ADR builds the mechanism a future policy decision would attach to, not the policy itself.

## Consequences

**What Aurora gains:**
- NFR-11's manual fallback and NFR-19's MFA requirement both have a concrete, buildable actor to attach to, without this document inventing product policy (who holds the flag, how many people, what approval process) that PRD open question 3 explicitly leaves to product.
- The mechanism reuses two patterns this codebase has already exercised successfully: the creator-portal RLS escape hatch (E3) and the `MFA_REQUIRED_FOR_ROLE` check (E1) -- no new authorization pattern is invented, lowering the risk of this epic's one genuinely new principal introducing a novel class of bug.
- Cross-tenant access is granted narrowly (three financial tables, not a general-purpose admin override) and is itself logged on every write (the manual-settlement endpoints write audit log entries, section 4.5 of the E6 architecture document) and on every read (`FinancialAccessAuditInterceptor`, NFR-23), so the privilege this principal carries is itself accountable, not a blanket exemption from oversight.

**What Aurora gives up:**
- Until product names a real policy, this flag is operationally equivalent to "anyone an administrator directly flips a database column for," which is a thinner governance model than any of FR-04's six roles have (each of which at least has an invitation flow and a visible membership record). This is an accepted, explicitly-flagged gap, not a hidden one.
- A single `aurora_operator` flag grants access to every tenant's payout data at once -- there is no narrower "only this creator" or "only this campaign" operator scope in this design. If product later wants scoped operators (e.g., one person handling only a subset of campaigns), that is new work on top of this flag, not a redesign of the RLS mechanism, the same relationship ADR-0030 already describes between its own flag and a future, more targeted notification mechanism.

**Risk:** A single compromised or over-privileged `aurora_operator` account can read or settle payout obligations across every tenant on the platform -- the broadest cross-tenant privilege this codebase has defined anywhere, broader than `agency_admin`'s own multi-client reach (which is still bounded to one workspace). Mitigation: mandatory MFA (this ADR), full audit logging on every read and write (NFR-23, NFR-17), and the explicit recommendation, recorded here rather than silently assumed, that product treat granting this flag with at least the scrutiny of a production database credential, not a product role, until a real policy exists.
