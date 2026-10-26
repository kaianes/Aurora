# ADR-0050: Creator Identity Reuses E1's Global `user`/Auth Pattern; Real Creator Login Replaces the E3 Pilot Stub

**Status:** Proposed
**Date:** 2026-10-21
**Epic:** E8 -- Creator Recruitment and Growth
**Governs:** US-24.1, FR-08

## Context

Until this epic, the only way a creator JWT could be issued was `backend/src/matching/creator-portal.controller.ts`'s `POST /creator-portal/login`, which takes a bare `creator_id` and issues a token with no password, no email verification, and no identity check whatsoever -- a pilot-only stub, explicitly labeled as such in its own code comment: "E8 owns the real creator login flow (social auth or magic link). This endpoint exists only so US-28 is testable end to end before that flow ships." US-24.1 now requires Aurora to "register and link my social accounts" -- a real registration, not a bare id lookup. A decision is needed about what a creator's actual identity and credential mechanism is.

E1's own architecture document is explicit that `USER` is "global -- a user can hold memberships in multiple accounts," and E3's architecture document (section 2.3) already established the structural shape this epic has to fit into: "Creators are not members of any account and hold no row in `membership`. A creator's JWT carries `sub = user_id` and a `creator_id` claim." This means the codebase already treats a creator as a `user` row without a `membership` row, rather than as a structurally distinct kind of principal -- the only missing piece is a real registration/login flow that actually populates that `user` row and issues that JWT shape honestly.

Two options were considered:

- **A second, creator-specific identity table and auth stack** (separate password hashing, separate verification tokens, separate login endpoint logic, parallel to but independent of `AuthService`). This would let creator-specific concerns (no MFA, no membership) be modeled with zero risk of accidentally coupling to brand/agency auth behavior, but it duplicates well-tested code (bcrypt work factor, enumeration protection, verification-token expiry, JWT issuance) for no behavioral benefit, and creates two places a future auth bug fix (e.g., a password-hashing upgrade) would need to land instead of one.
- **Reuse the existing global `user` table and `AuthService`'s registration/verification/login logic**, with `creator-network` calling into `auth`'s exported service rather than reimplementing it, and simply skipping workspace/account/membership creation for a creator registration.

## Decision

A creator's credential is a `user` row, created through the same `AuthService` code path E1 already built and tested (bcrypt work factor 12, breached-password screening, 32-byte cryptographically random verification tokens, 24-hour expiry, enumeration-safe responses) -- `auth.module.ts` exports the specific methods `creator-network` needs (`createUser`, `verifyEmailToken`, `authenticateCredentials`, refactored out of `AuthService`'s existing `register`/`verifyEmail`/`login` bodies without changing their brand-facing behavior), and `creator-network`'s registration/claim-confirm/login endpoints call those methods directly rather than reimplementing password hashing or token generation. The one deliberate divergence: a creator registration creates **no** `workspace`, `account`, or `membership` row -- only `user` and `creator` (with `creator.user_id` set), exactly the shape E3 already assumed. The issued JWT carries `sub = user.id` and `creator_id = creator.id`, with no `memberships` array -- the identical shape `JwtStrategy` (`backend/src/auth/strategies/jwt.strategy.ts`) already branches on for any token carrying a `creator_id` claim, requiring **zero changes** to that file.

**This decision replaces** `creator-portal.controller.ts`'s pilot-only `login` handler. US-28's opportunity accept/decline endpoints, which depend only on `CreatorAuthGuard` and the JWT's `creator_id` claim, require no change, because the replacement login issues the identical claim shape the stub always did.

MFA is **not** extended to creators: NFR-19 requires MFA "for roles that can approve payouts or change bank details," and creators hold no FR-04 role at all (they are not a `membership`-bearing principal), nor does any endpoint in this epic let a creator change bank details (per ADR-0033, no real payout adapter or bank-detail capture exists in this pilot at all). This is a direct, explicit non-extension, not an oversight.

## Consequences

**What Aurora gains:**
- Zero duplicated authentication logic: password hashing, breached-password screening, verification-token lifecycle, and enumeration protection are each implemented exactly once in this codebase, and a future fix or upgrade to any of them (e.g., raising bcrypt's work factor) benefits creators and brand/agency users simultaneously with one change.
- The creator JWT shape E3 already defined and `JwtStrategy` already handles needs no modification -- this epic's registration/login work is additive to `auth`, not a parallel system requiring its own guard, strategy, or token-verification logic.
- A creator who was recruited (claimed an unclaimed profile, section 4 of the architecture doc) and a creator who self-registered end up as structurally identical `user` + `creator` pairs, which is part of what makes US-26's "no special tier for recruited creators" guarantee hold at the identity layer, not just the matching layer.

**What Aurora gives up:**
- `auth.module.ts` now has two callers of its internal registration/verification logic (`auth`'s own brand-facing controller and `creator-network`'s), so a future change to that shared code has to be checked against both call sites' expectations -- a modest coordination cost, the same category E3/E6/E7 already accepted every time they called into a module they did not own (ADR-0032, ADR-0036, ADR-0047).
- Creators and brand/agency users share one `user.email` uniqueness constraint, meaning the same email address cannot register as both a brand user and a creator. This is treated as an acceptable, low-likelihood edge case for the pilot rather than a design flaw to solve now; a future product decision to allow the same person to hold both identities would need a schema change (e.g., allowing multiple `user` rows per email, scoped by principal type), which this ADR does not attempt to pre-solve.

**Risk:** Because creators carry no MFA and no membership-based role, a compromised creator credential has a narrower blast radius than a compromised brand/agency credential (no financial-approval capability, no cross-tenant reach) -- this is treated as an accepted non-risk (`docs/architecture.md`'s own N-series framing) rather than a gap, since extending MFA to a population with no financial-approval capability would add onboarding friction (working directly against NFR-24) for no corresponding security benefit.
