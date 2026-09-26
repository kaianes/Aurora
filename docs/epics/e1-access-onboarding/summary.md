# Epic E1, Access and Onboarding: Summary

**Author:** Kaiane Cordeiro. Aurora Project, Sprint 5. **Date:** September 25, 2026.

## 1. Purpose

This document summarizes what was built for Epic E1 (Access and Onboarding), checks it against the ADRs and architecture specification, reports the actual state of automated tests, and lists open items. It is the gate artifact reviewed before merging `feature/e1-access-onboarding` into `main`.

<p align="center"><strong>Table 1</strong></p>

<p align="center"><em>Stories in Scope for Epic E1</em></p>

<div align="center">

| Story | Priority | Persona | Status |
|---|---|---|---|
| US-01 Self-Service Brand Sign-Up | Must | Marina | Implemented, tested |
| US-02 Transparent Pricing Before Commitment | Must | Marina | Implemented, tested |
| US-03 Brand Profile Registration | Must | Marina | Implemented, tested, one stub (file storage) |
| US-04 Team Invitation with Defined Roles | Should | Marina | Implemented, tested |
| US-47 Agency Client Onboarding | Should | Renata | Implemented, tested |

</div>

*Note.* Priority follows the MoSCoW scale defined in the product requirements document. "Stub" marks functionality that is implemented and tested at the validation layer but does not yet persist to its intended real backend (see Section 3).

## 2. What Was Built

**Backend** (`backend/src`): NestJS modules mapping onto the stories, `auth` (US-01, ADR-0001), `pricing` (US-02), `brand-profile` (US-03, ADR-0004), `invitation` (US-04), `agency` (US-47), plus `common` (guards, decorators, middleware), `audit`, `workspace`, `jobs`. One TypeORM migration (`database/migrations/1695000000000-InitialSchema.ts`) creates all nine entities from architecture section 2.1. All API endpoints in `docs/architecture/e1-access-onboarding.md` section 3 exist and match documented shapes on inspection.

**Frontend** (`frontend/src`): implements the route map from architecture section 6 (`/pricing`, `/register`, `/verify-email`, `/invitations/accept`, `/login`, `/app/brand-profile`, `/app/team`, `/app/clients`, `/app/clients/:id`), with a shared API client, role helper, auth context, and small UI kit.

## 3. Compliance With ADRs and Architecture

**ADR-0001 (Authentication Strategy):** followed correctly, bcrypt, email verification gating login, short-lived JWT plus rotating refresh, TOTP MFA endpoints, enumeration-safe register and resend. MFA enforcement hook on role assignment present as specified.

*Gap:* `/auth/mfa/setup` and `/auth/mfa/confirm` exist and are wired into `frontend/src/lib/api-client.ts`, but no page or UI calls them. A user has no way to enable MFA for their own account; MFA only appears client-side as a code-entry step during login for accounts that already have it enabled server-side. NFR-19's "available to all users" clause is not reachable today.

**ADR-0002 (Tenant Isolation with Row-Level Security):** the migration correctly enables row-level security and forced row-level security, with tenant isolation policies on `account`, `brand_profile`, `invitation`, `membership`, `operator_client_access`.

*Significant deviation:* `TenantContextMiddleware` (`backend/src/common/middleware/tenant-context.middleware.ts`), which sets `app.current_account_id` via `SET LOCAL` on a dedicated `QueryRunner`, is never registered. `AppModule` has no `NestModule.configure()` and nothing else wires it in. It is dead code. Even if registered, `SET LOCAL` outside a real transaction on a throwaway connection never used by the actual repositories would not affect the queries services run. Every service checked (`brand-profile`, `invitation`, `agency`, `workspace`) uses `@InjectRepository` on the default pooled `DataSource` and filters by `accountId` explicitly at the application layer instead. This filtering was checked and looks consistent everywhere in this epic, but it means the database-enforced safety net ADR-0002 exists to guarantee is not actually engaged. A future forgotten `WHERE accountId = ...` clause would leak data silently. Additionally, no CI pipeline exists in the repository at all, so the row-level-security coverage build check required by the ADR was never built.

**ADR-0003 (Role-Based Access Control):** closely followed, fixed `Role` enum, global `RolesGuard` via `APP_GUARD`, `@Roles(...)` per route, denials logged to the audit log with actor, action, and target, `operator_client_access` second-layer scoping implemented in `AgencyService`.

*Gap:* no exhaustive "hit every route with the wrong role, expect 403" test exists as ADR-0003 recommends; only the specific denial scenarios named in the stories are tested.

**ADR-0004 (Brand Profile Draft Lifecycle):** matched, computed draft or complete status, single mutable row per account, no publish or approval step, confirmed by tests. Separately, the architecture doc's logo-upload spec (object storage plus signed URL) is not actually implemented: `brand-profile.service.ts` builds a URL string from a config value with a comment admitting it is a stand-in. File validation (size and format) is real and tested; persistence is not.

**Email delivery:** `EmailProcessor` (`backend/src/jobs/email.processor.ts`) is correctly wired to Bull and Redis and triggered at the right points, but its body only logs via `Logger` and returns a success flag. No SMTP or third-party email integration exists. US-01 scenario 1 and US-04 scenario 1 (email actually sent) are only demonstrable via server logs, not real delivery.

## 4. Test Results

<p align="center"><strong>Table 2</strong></p>

<p align="center"><em>Automated Test Results by Package</em></p>

<div align="center">

| Package | Command | Result |
|---|---|---|
| Backend | `npx vitest run` (from `backend/`) | 5 test files, 17 tests, all passing |
| Frontend | `npx vitest run` (from `frontend/`) | 0 tests executed, both spec files fail to start |

</div>

Backend results are genuine and map cleanly onto the stories (section 5). Frontend results are not usable evidence: both spec files (`pricing-page.spec.tsx`, `register-page.spec.tsx`) fail before running any test, with a `TypeError` from jsdom's `CacheStorage` shim being incompatible with the `undici` version under the current Node runtime, an environment or dependency-version mismatch between jsdom and vitest, not an application-code bug. Only two of five stories have any frontend spec at all, and neither currently runs.

## 5. Story Coverage

No separate qa pass or fail artifact exists in the repository for this epic. Mapping directly to backend automated tests instead:

<p align="center"><strong>Table 3</strong></p>

<p align="center"><em>Story Coverage Against Automated Tests</em></p>

<div align="center">

| Story | Priority | Backend evidence | Frontend evidence | Verdict |
|---|---|---|---|---|
| US-01 | Must | `auth.service.spec.ts`: registration flow, enumeration protection, expired-token resend | spec file exists, does not execute | Backend evidenced; frontend unverified |
| US-02 | Must | `pricing.service.spec.ts`: full fee model, both plan types | spec file exists, does not execute | Backend evidenced; frontend unverified |
| US-03 | Must | `brand-profile.service.spec.ts`: draft or complete status, file-size and format rejection | none | Backend evidenced; no frontend coverage; upload persistence stubbed |
| US-04 | Should | `invitation.service.spec.ts`: invite created, existing-user accept, duplicate-pending conflict, analyst denial and log | none | Backend evidenced; no frontend coverage |
| US-47 | Should | `agency.service.spec.ts`: client created, template copy without data, limit enforced, operator filtering | none | Backend evidenced; no frontend coverage |

</div>

Every Must and Should story has backend automated coverage for its normal, hard, and failure scenarios; none shipped with zero verification. The NFR-16 sub-scenarios in US-04 and US-47 are both tested. "Tested" here means API and service-layer only, not end-to-end through the UI.

## 6. Deviations Summary

1. Critical: row-level security defined in the schema but never engaged at runtime, since the middleware is unregistered; isolation relies solely on application-layer filtering.
2. Moderate: no CI pipeline exists; ADR-0002's row-level-security coverage check and ADR-0003's route sweep are unbuilt.
3. Moderate: MFA setup and confirm have no frontend entry point.
4. Minor, expected at pilot stage: logo upload not persisted to object storage; email is a console-log stub.
5. Test tooling: the frontend suite does not run at all due to a jsdom and Node version mismatch.

## 7. Open Items for the Next Epic

- Register the tenant-context middleware correctly (within a real transaction) and add a test proving zero rows are returned without `app.current_account_id` set.
- Build the row-level-security coverage CI check and a route-authorization sweep test.
- Add a frontend MFA setup flow.
- Fix the frontend test environment and add specs for US-03, US-04, and US-47.
- Replace the object storage and email stubs with real integrations before pilot use.
- Consider dedicated end-to-end coverage for `operator_client_access` before Epic 8 depends on it.

## References

The entries below follow APA 7th-edition style and are listed alphabetically.

Aurora Project Team. (2026). *ADR-0001: Authentication strategy*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0002: Tenant isolation with PostgreSQL row-level security*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0003: Role-based access control with workspace-scoped roles*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0004: Brand profile draft lifecycle*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *E1, Access and onboarding: Stories*. Internal product requirements document, Aurora project.

Aurora Project Team. (2026). *E1, Access and onboarding: Technical architecture*. Internal architecture specification, Aurora project.
