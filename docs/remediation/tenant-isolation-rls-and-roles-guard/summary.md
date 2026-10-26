# Tenant Context Engagement and RolesGuard Fail-Closed Fix: Summary

**Author:** Kaiane Cordeiro. Aurora Project, cross-cutting remediation. **Date:** October 25, 2026.

> **TL;DR.** Commit `dadb786` implements ADR-0063 (tenant context engagement via a post-guard interceptor) and ADR-0064 (RolesGuard fails closed when no account context resolves), closing the single most-repeated critical finding named in every one of the project's nine epic review summaries (E1 through E9: the `app.current_account_id` session variable every row-level security policy depends on was never actually set on the connection a request's queries ran against) together with a related, independently-reasoned authorization bypass (a creator-portal JWT could reach any brand- or agency-scoped route with no `X-Account-Id` header and skip role checks entirely, not just the creator-portal routes a stale code comment assumed were the only case). This review independently re-ran the full backend suite (87 files, 518 tests, all passing), a clean `nest build`, and `oxlint --type-aware`, confirming the 2 pre-existing `tsconfig.json` errors are unchanged (that file was last touched in Epic 1's own commit, `08ecb1b`, not in this diff) and no new lint issue was introduced on any of the 24 touched files. The wiring was checked line by line against both ADRs' own specifications and found compliant in every particular, including the exhaustive, one-to-one pairing of all 13 `@UseGuards(CreatorAuthGuard)` call sites with the new `@CreatorPortalRoute()` decorator (verified by this review's own grep, not merely counted from the commit message). One real gap was found in the unit-level acceptance-test coverage ADR-0064 itself specifies: the route-sweep integration test meant to keep that 13-site pairing from silently going stale was never written. **Two open items dominate this document and must not be read as resolved by anything above.** First, the real-Postgres integration test ADR-0063's own "Acceptance tests" section says is the *only* way to prove the actual claim (that PostgreSQL returns only the correct tenant's rows under connection-pool reuse) was not run, because this environment has no Docker access and no reachable Postgres instance; the honest status, in the ADR's own words, is "specified and unit-tested, but not proven." Second, and more consequentially, this review surfaces a new, unconfirmed hypothesis that could make the entire fix moot at the database layer: `docker-compose.yml` sets `POSTGRES_USER: aurora` with no init script and no migration anywhere creates a separate, non-superuser application role, and the official `postgres` Docker image makes `POSTGRES_USER` the actual `initdb` bootstrap superuser when nothing else customizes it; Postgres superusers carry `BYPASSRLS` by default, and RLS policies, including `FORCE ROW LEVEL SECURITY` ones, are ignored entirely for any role with that attribute. If Aurora has always connected as this same superuser, every RLS policy written since Epic 1 has been silently inert for a reason that has nothing to do with whether this fix's interceptor sets the session variable correctly. This has not been checked against a live instance (none was reachable) and is stated here as a hypothesis, not a fact, with the one command that would settle it.

## 1. Purpose

This document reviews a cross-cutting remediation fix, not a product epic: there is no `stories.md` for this work, and its acceptance criteria are the two governing ADRs' own "Decision" and "Acceptance tests" sections, not a PRD-traced user story table. It checks commit `dadb786`'s actual diff against `docs/adr/0063-tenant-context-engagement-via-post-guard-interceptor.md` and `docs/adr/0064-roles-guard-fail-closed-on-unresolved-account.md` in full, independently re-runs the automated test suite, build, and lint, and lists what remains open, including two items that must be weighed before this is treated as a closed finding. It is the gate artifact a human reviews before this fix merges past `main`'s current head.

## 2. What Was Built

**ADR-0063 (tenant context engagement).** `src/common/middleware/tenant-context.middleware.ts` is deleted outright, not migrated; it was never registered in `app.module.ts` and, per the ADR's own analysis, could never have worked as middleware because `req.user` is not populated until `JwtAuthGuard` runs, which happens after middleware in NestJS's fixed pipeline order. In its place:

- `src/common/tenant-context/tenant-context.runner.ts` (new): a thin, Aurora-named wrapper around `typeorm-transactional`'s `runInTransaction`, exposing `runAsAccount(accountId, work)` and `runAsCreatorPortal(work)`. Each opens a transaction via the third-party library's `AsyncLocalStorage` patch and issues `SET LOCAL app.current_account_id = $1` (bound parameter, never interpolated) or `SET LOCAL app.creator_portal = 'true'` as the first statement before `work()` runs.
- `src/common/interceptors/tenant-context.interceptor.ts` (new): a `NestInterceptor` that reads `request.user` and `request.currentAccountId` (the latter set only by `RolesGuard`, never re-derived from headers here) and wraps `next.handle()`'s subscription, via `defer`/`lastValueFrom`, inside `runAsCreatorPortal` when `user?.isCreator`, inside `runAsAccount` when an `accountId` resolved, or passes through unpinned otherwise.
- `src/common/tenant-context/tenant-context.module.ts` (new): a `@Global()` module providing and exporting both of the above, mirroring `CommonModule`'s own reason for being global, since `APP_INTERCEPTOR` resolves in `AppModule`'s own injector context.
- `src/app.module.ts`: imports `TenantContextModule`, registers `TenantContextInterceptor` via `{ provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor }` alongside the two existing `APP_GUARD` entries, and adds `extra: { max: 25 }` to the `TypeOrmModule.forRootAsync` factory (previously unset, meaning the `pg` driver default of 10), with an inline comment reasoning from NFR-07/NFR-04 exactly as the ADR's "Connection pool sizing" section anticipated this decision would need to be made explicitly, not left at the default.
- `src/main.ts`: calls `initializeTransactionalContext()` before `NestFactory.create`, and `addTransactionalDataSource(app.get(DataSource))` after creation and before `app.listen`, a one-time process-level patch of the bootstrapped `DataSource`.
- `backend/package.json`: adds `typeorm-transactional@^0.5.0` as a direct dependency (`package-lock.json` updated accordingly, 87 lines).

**ADR-0064 (RolesGuard fail-closed).** `src/common/guards/roles.guard.ts`'s `canActivate` now checks, in order: `@Public()` metadata (returns `true`, unchanged behavior, now explicit rather than accidental); `@CreatorPortalRoute()` metadata (returns `true`, the one legitimate case for a route with no account context); then, if neither applies and no `accountId` resolves from `X-Account-Id` or `user.currentAccountId`, writes an `authorization.denied` audit log entry with `metadata.reason = 'no_account_context'` and throws a `ForbiddenException` with the existing `INSUFFICIENT_PRIVILEGES` error shape, rather than returning `true` as it did before. Everything from the existing `resolveAccess` call downward is untouched. A new decorator, `src/common/decorators/creator-portal-route.decorator.ts` (`CreatorPortalRoute()`, metadata key `creatorPortalRoute`), is exported from `src/common/decorators/index.ts` and applied at all 13 existing `@UseGuards(CreatorAuthGuard)` call sites across 9 files: 7 class-level (`media-kit.controller.ts`, `rate-preference.controller.ts`, `onboarding.controller.ts`, `creator-portal-payout.controller.ts`, `creator-portal-performance.controller.ts`, `creator-portal-briefing.controller.ts`, `creator-portal-content-submission.controller.ts`) and 6 method-level, split across two files (`creator-portal.controller.ts`'s `list`/`accept`/`decline`, and `social-account.controller.ts`'s `authorize`/`list`/`disconnect`, deliberately excluding that file's fourth method, `callback`, which carries `@Public()` instead and correctly receives no new decorator).

**Tests added.** `backend/src/common/guards/roles.guard.spec.ts` (new, 8 tests) and `backend/src/common/interceptors/tenant-context.interceptor.spec.ts` (new, 3 tests). `backend/src/invitation/invitation.service.spec.ts`'s existing `RolesGuard` mock is updated so its `Reflector.getAllAndOverride` stub returns the right value per metadata key (`IS_PUBLIC_KEY` / `CREATOR_PORTAL_ROUTE_KEY` / `ROLES_KEY`) instead of a single unconditional return value, which the guard's new three-way check would otherwise have broken.

## 3. Compliance With ADR-0063 and ADR-0064

**ADR-0063:** followed exactly, checked clause by clause against the actual diff rather than the commit message's own narrative.

- The deleted middleware's two `SET LOCAL` statements reappear, unchanged in SQL, inside `TenantContextRunner`'s two methods, exactly as the ADR's step 1 specifies.
- The interceptor consumes `request.currentAccountId` (set by `RolesGuard`) and never re-derives it from `X-Account-Id` or `user.currentAccountId` directly, exactly as the ADR requires to avoid duplicating or second-guessing `RolesGuard`'s own resolution. This is also the one property `tenant-context.interceptor.spec.ts`'s second test is written specifically to prove, using three deliberately different values for the header, the JWT claim, and the resolved field, and asserting the runner is called with only the resolved one.
- Registration is via `APP_INTERCEPTOR` in `app.module.ts`'s `providers` array, listed after the two `APP_GUARD` entries, matching the ADR's own stated rationale (ordering within the array does not affect correctness, since interceptors run after all guards by pipeline phase; the ADR asks for this ordering only to document intent to a future reader, which the diff does).
- `main.ts`'s two new calls match the ADR's step 6 exactly, including the ordering (`initializeTransactionalContext()` before `NestFactory.create`, `addTransactionalDataSource` after creation and before `listen`).
- Pool sizing was made explicit (`extra: { max: 25 }`) with a reasoning comment that traces to NFR-07 and NFR-04 by name, matching the ADR's instruction that picking a number, explicitly, is part of this fix rather than a deferred follow-up. The ADR deliberately does not mandate a specific number, so 25 is not itself checked against anything beyond "an explicit, reasoned choice exists," which it does.
- The two disclosed, accepted consequences in the ADR's own "Consequences" section (Bull job processors remain unpinned; `auth.service.ts`/`invitation.service.ts`/`creator-registration.service.ts` will hold two connections simultaneously for the one request that hits each) are unaffected by this diff, exactly as the ADR says they should be: no change to any Bull processor file, and no change to those three services' own `queryRunner` usage, appears anywhere in the diff.

**ADR-0064:** followed exactly, likewise checked against the diff directly.

- The three-way check order (`@Public()`, then `@CreatorPortalRoute()`, then the existing `accountId` resolution) matches the ADR's own pseudocode precisely, including the exact audit-log shape (`action: 'authorization.denied'`, `metadata.reason: 'no_account_context'`) and the unchanged `INSUFFICIENT_PRIVILEGES` error body.
- The 13-site enumeration in ADR-0064's own "Decision" section (7 class-level, `creator-portal.controller.ts`'s 3 methods, `social-account.controller.ts`'s 3 methods excluding `callback`) matches the actual diff one for one; this review independently re-ran `grep -rn "UseGuards(CreatorAuthGuard)"` and `grep -rn "@CreatorPortalRoute()"` across `backend/src` and got 13 and 13, respectively, with every `CreatorAuthGuard` site carrying exactly one `CreatorPortalRoute()` at the same level. `social-account.controller.ts`'s `callback` method was independently confirmed to still carry only `@Public()`, not the new decorator, as the ADR specifies it must not.
- No change below the existing `if (!resolvedRole)` check, confirmed by direct read of `roles.guard.ts` lines 85 onward: `resolveAccess`, the role-mismatch branch, and the `request.currentAccountId`/`request.currentRole` assignment are byte-for-byte what they were before this commit except for the lines above them.

**No deviation from either ADR's Decision section was found.** One deviation from ADR-0064's own Acceptance Tests section was found and is recorded in Section 5 below, since it concerns test coverage rather than the production logic itself.

## 4. Test Results

<p align="center"><strong>Table 1</strong></p>

<p align="center"><em>Automated Test and Static-Analysis Results, Independently Re-Run for This Review</em></p>

<div align="center">

| Check | Command | Result |
|---|---|---|
| Backend tests | `npm test` (`vitest run`, from `backend/`) | 87 test files, 518 tests, all passing |
| Backend build | `npm run build` (`nest build`, from `backend/`) | Clean, no output, no errors |
| Backend lint | `npm run lint` (`oxlint --type-aware src/ test/`, from `backend/`) | 2 pre-existing `tsconfig.json` errors (`moduleResolution=node10` removed; `baseUrl` removed), unchanged from baseline; a handful of pre-existing warnings in files this commit does not touch (unused imports/vars in `invitation.service.ts`, `agency.service.ts`, `brand-profile.service.ts`, two spec files, two DTO regex escapes); zero new warnings or errors on any of this commit's 24 touched files |

</div>

*Note.* The commit message claims "516 -> 518 backend tests passing" and a clean build with lint unchanged; both claims were independently verified by this review rather than taken on the commit's own say-so. `tsconfig.json` was last modified in `08ecb1b` (Epic 1's own initial commit), confirmed by `git log -- backend/tsconfig.json`, and is absent from `dadb786`'s changed-file list, confirming the 2 lint errors predate this fix and are not introduced or masked by it.

Coverage specific to this fix: `roles.guard.spec.ts` (8 tests, new file) and `tenant-context.interceptor.spec.ts` (3 tests, new file), both independently re-read and re-run for this review, not only counted. `invitation.service.spec.ts`'s mock update was confirmed necessary: without it, that file's own `RolesGuard` reconstruction test would have broken under the guard's new three-branch `Reflector` read, since its old mock returned the same `[Role.BRAND_OWNER, Role.AGENCY_ADMIN]` array regardless of which metadata key was being asked about, which the new `isPublic`/`isCreatorPortalRoute` checks would have misread as truthy.

## 5. Acceptance-Test Coverage Against Each ADR's Own Specification

Both ADRs specify their own acceptance tests. This section checks what was actually written against what each ADR actually asked for, not against a generic notion of "good coverage."

<p align="center"><strong>Table 2</strong></p>

<p align="center"><em>ADR-0063 Acceptance Tests, Unit-Level (the only level this environment could exercise)</em></p>

<div align="center">

| Acceptance test ADR-0063 specifies | Implemented? | Evidence |
|---|---|---|
| Mocked request, `user.isCreator = true`: calls `runAsCreatorPortal`, not `runAsAccount` | Yes | `tenant-context.interceptor.spec.ts`, test 1 |
| Mocked request, `request.currentAccountId` set, `isCreator` falsy: calls `runAsAccount` with exactly that id, not a value re-read from headers or `user.currentAccountId` | Yes | `tenant-context.interceptor.spec.ts`, test 2 (uses three distinct values to force the distinction) |
| Mocked request, neither signal: calls neither, still calls `next.handle()` | Yes | `tenant-context.interceptor.spec.ts`, test 3 |
| Real-Postgres: exactly account A's rows return, never account B's, under one request | **No** | No Postgres reachable in this environment (Section 6) |
| Real-Postgres: no resolvable account id and no creator flag yields zero rows, not an error, not all rows | **No** | Same reason |
| Real-Postgres: two near-simultaneous requests against a small, reused pool never cross-contaminate `current_setting` | **No** | Same reason; this is the ADR's own stated "the one property this whole ADR exists to guarantee" test |
| Real-Postgres: the creator-portal escape hatch still works unchanged | **No** | Same reason |

</div>

<p align="center"><strong>Table 3</strong></p>

<p align="center"><em>ADR-0064 Acceptance Tests (fully unit-provable per the ADR's own text)</em></p>

<div align="center">

| Acceptance test ADR-0064 specifies | Implemented? | Evidence |
|---|---|---|
| `@Public()`, no user: returns `true`, no audit log | Yes | `roles.guard.spec.ts`, test 1 |
| `@CreatorPortalRoute()`, no resolvable accountId: returns `true`, no audit log, `resolveAccess` not called | Yes | `roles.guard.spec.ts`, test 2 |
| Neither decorator, creator-flavored user, no `X-Account-Id`: throws, logs `reason: 'no_account_context'` exactly once, `resolveAccess` not called | Yes | `roles.guard.spec.ts`, test 3 |
| Neither decorator, non-creator user, no `X-Account-Id`: same assertions | Yes | `roles.guard.spec.ts`, test 4 |
| Neither decorator, resolvable accountId, `resolveAccess` returns falsy: unchanged behavior, `reason: 'no_account_relationship'` | Yes | `roles.guard.spec.ts`, test 5 |
| Route-sweep integration test: every route carrying `@UseGuards(CreatorAuthGuard)` also carries `@CreatorPortalRoute()`, and vice versa, enumerated via Nest's own router introspection | **No** | Not found anywhere in the diff or the existing suite (`grep -rln "route-sweep\|every registered route" backend/src` returns nothing) |

</div>

**The missing route-sweep test is a real gap, not a cosmetic one.** ADR-0064 is explicit that this test exists specifically "to keep the 13-site list in this ADR from silently going stale as new creator-portal routes are added," failing the build "the moment the two decorators diverge, rather than waiting for a tenth [review] to notice by hand." Today, the 13-site pairing is correct (verified independently in Section 3), but nothing in the automated suite would catch a future developer who adds a 14th creator-portal controller with `@UseGuards(CreatorAuthGuard)` and forgets `@CreatorPortalRoute()`. Per the ADR's own "Risks" section, the failure direction for that mistake is the safe one (every request to the new route gets a 403 until noticed, not a silent bypass), but "safe failure direction" is not the same guarantee as "the build fails before merge," which is what this specific test was supposed to provide and does not yet.

## 6. The Two Open Items That Matter Most

These are stated first and most prominently in this section deliberately, because of how much either one, if confirmed, would undercut everything verified above.

**Open item 1: the real-Postgres integration test ADR-0063 itself says is the only way to prove its actual claim was never run.** ADR-0063's own "Acceptance tests this fix needs, and whether they can be mocked" section states plainly: "the actual claim this fix makes, that PostgreSQL itself returns only the correct tenant's rows, cannot be proven by a unit test against a mocked `DataSource`." This review attempted to verify this directly rather than accept the gap as given: `docker ps` returned `permission denied while trying to connect to the docker API at unix:///var/run/docker.sock`; `sudo docker compose up` is blocked by this environment's own tool-use policy; and a direct TCP probe of `127.0.0.1:5432` returned `Connection refused`. No real Postgres instance was reachable by any means available in this environment. The honest status of this fix, stated in the ADR's own words, is **"specified and unit-tested, but not proven."** The unit-level tests in Section 5, Table 2 confirm the interceptor's wiring is correct; they do not and cannot confirm that PostgreSQL's RLS engine actually filters rows correctly under connection-pool reuse, which is the entire point of the fix.

**Open item 2 (new finding from this review, unconfirmed, and potentially the most consequential item in this entire remediation effort): the application's Postgres role may be a superuser with implicit `BYPASSRLS`, which would make every RLS policy a no-op independent of whether this fix's wiring is correct.** `docker-compose.yml` (read in full for this review) sets:

```
POSTGRES_USER: aurora
POSTGRES_PASSWORD: aurora
POSTGRES_DB: aurora
```

with no init script and no customization beyond these three environment variables. A grep across every migration file and `docker-compose.yml` for `CREATE ROLE`, `NOSUPERUSER`, `BYPASSRLS`, `ALTER ROLE`, or `ALTER USER` returned zero matches: `grep -rn "CREATE ROLE\|NOSUPERUSER\|BYPASSRLS\|ALTER ROLE\|ALTER USER" backend/src/database/migrations/ docker-compose.yml` found nothing. The official `postgres` Docker image's own documented behavior is that when `POSTGRES_USER` is set with no further customization, that user becomes the actual `initdb`-created bootstrap superuser for the cluster, not an ordinary role created afterward. PostgreSQL superusers carry the `BYPASSRLS` attribute by default, and per PostgreSQL's own documentation, every row-level security policy, including one declared with `FORCE ROW LEVEL SECURITY` (which every tenant-scoped table in this schema uses), is ignored entirely for any role with that attribute. **If the application has always connected to Postgres as this same `aurora` superuser role, then every RLS policy written since the very first migration has been silently inert for a structural, infrastructure-level reason that has nothing to do with whether `TenantContextInterceptor` sets `app.current_account_id` correctly.** Today's fix, however correctly wired (Section 3 confirms it is), would still not enforce tenant isolation at the database layer if this hypothesis holds.

This is stated here as an unconfirmed hypothesis, not a settled fact, because it has not been checked against a live instance; none was reachable in this environment (same connectivity failure as Open item 1). It is flagged this prominently precisely because of how much it would undercut if confirmed true, and because it would not be caught by the unit tests in Section 5 or by the deferred integration test in Open item 1 either, unless that integration test's own setup step specifically checks the connecting role's attributes rather than only exercising RLS behavior from inside the application. **The one command that would settle this, the moment a Postgres instance is reachable:**

```sql
SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'aurora';
```

If either column returns `true`, every RLS policy in this schema has always been, and remains after this fix, a no-op, and closing that would require either a dedicated, non-superuser application role (the standard, documented fix: `CREATE ROLE aurora_app LOGIN PASSWORD '...' NOSUPERUSER;` plus the matching `GRANT`s, with the application's connection string repointed at it) or an equivalent change to how the Docker image bootstraps its roles, as a new, separate, likely higher-priority fix than anything in this document.

## 7. Other Open Items Carried Forward (Not Closed by This Fix)

This fix closes the tenant-context-engagement and RolesGuard-bypass findings specifically. It does not touch, and does not imply resolution of, the following items, each already on record elsewhere in more detail:

- **The creator decline-opportunity bug.** `OpportunityService.decline` (`backend/src/matching/opportunity.service.ts`, line 145) calls `this.entryRepo.update({ id: saved.shortlistEntryId }, { included: false })`, an `UPDATE` against `campaign_shortlist_entry`. The `shortlist_lock_guard`/`prevent_locked_shortlist_entry_mutation` trigger (`backend/src/database/migrations/1705000000000-MatchingSchema.ts`, lines 137-149) raises an exception on any such update once the entry's parent shortlist is locked. Since a `CampaignOpportunity` only ever exists after `lockAndHandoff` has already locked the shortlist (confirmed in E3's own summary, Section 3), this update will fire against an always-locked row, and this code path has never been exercised against a real Postgres instance by this project's unit-mocked test suite, which cannot see a database trigger.
- **The missing `CONFIRMED -> ACTIVE` campaign transition.** Confirmed still true by this review (`grep -rn "CampaignState.ACTIVE" backend/src`): only `resume()` ever sets a campaign to `ACTIVE`, and only from `PAUSED`; no code path transitions `CONFIRMED -> ACTIVE`, so `pause()`'s own guard (`if (campaign.state !== CampaignState.ACTIVE)`) can never be satisfied via the normal lifecycle. Already tracked in detail in `docs/epics/e3-creator-matching-curation/summary.md`, Sections 6 and 7.
- **The geography/age_range/gender matching dimensions.** Confirmed still true by this review (`backend/src/matching/real-matching-engine.adapter.ts`, lines 196-216): all three dimensions unconditionally push a "matched" entry whenever the campaign's targeting criteria mention them, regardless of whether the creator entity carries any corresponding data (the minimal `creator` entity per ADR-0013 has none). The `geography` instance of this gap is already disclosed in `docs/epics/e3-creator-matching-curation/summary.md`, Sections 3 and 7; the `age_range` and `gender` instances share the identical code pattern but are not named in any prior epic summary.
- **No CI pipeline exists anywhere in this repository.** Already tracked in `docs/epics/e1-access-onboarding/summary.md`, `docs/epics/e8-creator-recruitment-growth/summary.md`, and `docs/epics/e9-agency-multi-client-operations/summary.md`. Confirmed still true.
- **The frontend Vitest alias is hardcoded to a local machine path.** `frontend/vitest.config.ts`, line 8: `'@': '/home/kaiane/Documents/Aurora/frontend/src'`, an absolute path rather than `path.resolve(__dirname, './src')` or equivalent.
- **The backend `tsconfig.json`'s two invalid options break type-aware lint.** `moduleResolution: "node10"` (removed by current TypeScript) and `baseUrl` (removed). Confirmed unchanged and pre-existing in Section 4 above.
- **No creator seed data exists.** No seed script or fixture was found anywhere under `backend/src/database`.
- **The field-research PII and dead-credential git-history-rewrite decision, deferred from an earlier remediation step in this same session.** Commit `975dfc9` removed three named interview-analysis PDFs and a rotated demo password from the current tree, but performed no history rewrite. Every commit before `975dfc9` carrying this material is still fetchable from all three configured remotes, including the public GitHub mirror, since no force-push or history rewrite occurred.

## 8. Closing Assessment

**Is the fix itself, as specified in both ADRs, correctly and completely implemented?** Yes. Every clause of both ADRs' "Decision" sections was checked against the actual diff, not against the commit message's own description of it, and no deviation was found. The 13-site decorator pairing is exhaustive and exactly correct, independently reverified. The full backend suite passes (518/518, re-run independently), the build is clean, and lint shows zero new issues on any of the 24 touched files.

**Is the problem this fix set out to solve actually solved?** This is the honest question this document cannot answer yes to, and it should not be read as answering yes. Both ADRs are explicit that their deepest claim (PostgreSQL itself enforces tenant isolation under real traffic and connection reuse) requires a real database to prove, and none was reachable in this environment. More importantly, Section 6's second open item means there is now a live, unconfirmed possibility that the database layer underneath this entire remediation effort has never enforced RLS at all, for a reason that would make the correctness confirmed in Sections 3 through 5 irrelevant to the actual security posture of the running system. That possibility was not raised in either ADR and is new to this review. Until it is checked against a live Postgres instance with the one query in Section 6, this fix should be understood as "the application-side half of the contract is now correctly wired," not as "tenant isolation is proven to hold."

**What should happen next, in order:** (1) get a reachable Postgres instance, run `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'aurora';`, and resolve Open item 2 one way or the other before trusting RLS at all; (2) if that comes back clean, run the real-Postgres integration suite ADR-0063 specifies to close Open item 1; (3) write the route-sweep test ADR-0064 specifies but this commit did not include; (4) treat every other item in Section 7 as exactly as open as it was before this fix, since none of them were touched by it.

## References

Aurora Project Team. (2026). *ADR-0002: PostgreSQL row-level security as the tenant isolation mechanism*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0003: RolesGuard and account-access resolution*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0013: minimal creator entity in Epic 3*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0062: audit log read endpoint, RLS retrofit*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0063: tenant context engagement via a post-guard interceptor and an AsyncLocalStorage-pinned connection*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0064: RolesGuard fails closed when no account context resolves*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *Architecture: quality attribute scenario QAS-03, tenant isolation in an agency workspace*. Internal architecture specification, Aurora project.

Aurora Project Team. (2026). *E1, Access and onboarding: Summary*. Internal epic summary, Aurora project.

Aurora Project Team. (2026). *E3, Creator matching and curation: Summary*. Internal epic summary, Aurora project.

Aurora Project Team. (2026). *E6, Payments and financial transparency: Summary*. Internal epic summary, Aurora project.

Aurora Project Team. (2026). *E7, Analytics and reporting: Summary*. Internal epic summary, Aurora project.

Aurora Project Team. (2026). *E8, Creator recruitment and growth: Summary*. Internal epic summary, Aurora project.

Aurora Project Team. (2026). *E9, Agency multi-client operations: Summary*. Internal epic summary, Aurora project.

Aurora Project Team. (2026). *Product requirements document*. Internal product requirements document, Aurora project.

PostgreSQL Global Development Group. (2024). *Row security policies*. PostgreSQL 16 documentation. https://www.postgresql.org/docs/16/ddl-rowsecurity.html

PostgreSQL Global Development Group. (2024). *CREATE ROLE*. PostgreSQL 16 documentation. https://www.postgresql.org/docs/16/sql-createrole.html

Docker, Inc. (n.d.). *postgres: official image*. Docker Hub. https://hub.docker.com/_/postgres
