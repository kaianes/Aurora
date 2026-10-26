# ADR-0063: Tenant Context Engagement via a Post-Guard Interceptor and an AsyncLocalStorage-Pinned Connection

**Status:** Proposed
**Date:** 2026-10-25
**Epic:** Cross-cutting -- Tenant Isolation Remediation (identified in every epic review from E1 through E9; not scoped to a single epic)
**Governs:** NFR-16, FR-04, FR-07 (formalizes the enforcement half of ADR-0002 and ADR-0003, which this ADR closes the gap in; also the precondition for ADR-0062's audit-log read policy actually engaging)
**Related:** ADR-0064 (RolesGuard fail-closed fix). Both are required together; neither is sufficient alone -- see "Relationship to ADR-0064" below.

## Context

ADR-0002 decided that Aurora's tenant isolation is enforced by PostgreSQL row-level security (RLS), keyed on a session variable, `app.current_account_id`, set "at connection checkout" so that "a handle without one cannot be obtained" (`docs/architecture.md`, QAS-03). Every migration since `1695000000000-InitialSchema.ts` has written the correct half of this contract: every tenant-scoped table has `ENABLE ROW LEVEL SECURITY`, `FORCE ROW LEVEL SECURITY`, and a policy of the form `USING (account_id = current_setting('app.current_account_id', true)::uuid)`.

The other half of the contract -- actually setting that session variable on the connection a request's queries run against -- has never worked, and every epic since E1 has said so in its own review summary. Checking the code directly, rather than repeating that claim, surfaces three compounding problems, not one:

**1. The middleware that sets the variable is never registered.** `TenantContextMiddleware` (`src/common/middleware/tenant-context.middleware.ts`) is a complete, injectable `NestMiddleware`, but `AppModule` (`src/app.module.ts`) is a plain `@Module({...})` with no `implements NestModule` and no `configure()` method. Nothing ever calls `.use()` on it. This is the bug every prior summary names.

**2. Registering it as middleware would not fix it, because of NestJS's own request lifecycle, not just a missing line of code.** NestJS runs `Middleware -> Guards -> Interceptors -> Pipes -> Handler`, in that order, for every request. `TenantContextMiddleware.use()` reads `(req as any).user` to decide whether to set `app.creator_portal` or `app.current_account_id`. But `req.user` is populated by Passport, which runs inside `JwtAuthGuard` -- a **guard**, which executes strictly after middleware. Had this middleware simply been registered via `consumer.apply(TenantContextMiddleware).forRoutes('*')` as the obvious one-line fix, `req.user` would be `undefined` at the point it runs, on every request, for every route, every time. The `X-Account-Id` header path would still work (it reads the header directly), but the `user?.currentAccountId` fallback and the entire `user?.isCreator` creator-portal branch could never fire. This is not a hypothetical: it is how Nest's pipeline is specified to behave, and it means the obvious fix is also a wrong fix. Any registration of this logic has to run after authentication, which rules out Nest/Express middleware as the mechanism entirely, independent of the next problem.

**3. Even set on the right connection, `SET LOCAL` is scoped to a transaction that is never opened, and that connection is never the one later queries run on.** `SET LOCAL` only holds until the end of the current transaction block; run outside an explicit transaction, it is a no-op after its own implicit single-statement transaction commits. The middleware never calls `startTransaction()`. Even if it did, it would not matter: Aurora's 70 services inject repositories the standard way, `@InjectRepository(Entity)`, which NestJS resolves once at bootstrap to a singleton `Repository` bound to the `DataSource`'s shared connection pool. Every `repo.find()` / `.save()` / `.query()` call checks a connection out of that pool independently, at call time, with no relationship to the middleware's own dedicated `queryRunner`. Setting a session variable on one connection does nothing for a query that runs on a different one. A grep of the codebase (236 occurrences across 70 files: `@InjectRepository`, `@InjectDataSource`, or a directly-injected `DataSource`) confirms this is the universal data-access pattern, not an exception. There is no `AsyncLocalStorage`, `Scope.REQUEST`, or transactional-context plumbing anywhere today.

The database side of the contract is real and correctly written. The application side has never existed. This ADR specifies what has to exist for ADR-0002's own stated design -- "a repository layer sets the tenant context at connection checkout" -- to actually be true at runtime.

### What "connection checkout" has to mean for a singleton-DI app

In a request-scoped-everything app, "set the variable at checkout" is trivial: each request gets its own object graph, each with its own connection. Aurora is not that app, by design (singleton services, one shared pool, standard `@InjectRepository`), and changing that is a much larger decision than this one, evaluated and rejected below. So "checkout" has to be redefined: not "the moment a repository method is called" (too late to control without touching every call site), but "the moment we know who is making the request and what account they are allowed to act as" -- which, after authentication and authorization have both run, is a single, well-defined point in the pipeline, the same one RolesGuard already reaches today.

Three ways to get a query issued by a singleton repository to run against a specific, request-scoped connection were considered:

**Option A -- `Scope.REQUEST` everywhere.** Mark every service (or at least every service that touches a tenant-scoped repository) `@Injectable({ scope: Scope.REQUEST })`, inject a request-scoped `DataSource`/`EntityManager` (itself provided by a request-scoped factory that reads the account id off the request and checks out a pinned connection), and let Nest's DI graph do the rest. This is the textbook-correct answer and the one most tutorials recommend for exactly this problem.

Rejected for Aurora specifically because of blast radius, not correctness: every one of the 70 files above, every module that provides them, and every controller or processor that injects them would need to change, since Nest re-instantiates an entire request-scoped provider's dependency subgraph per request -- a provider cannot be request-scoped while most of its consumers stay singleton-scoped without the singleton consumers losing the per-request behavior they'd need this for. This is a sitewide refactor of the whole backend, carrying real risk of subtle DI-wiring breakage across nine epics' worth of code with no integration-test harness to catch it (see "Acceptance tests" below), for a fix whose actual job is narrower: make one existing, already-correct SQL contract engage.

**Option B -- thread an `EntityManager`/`queryRunner` explicitly through every service method.** A handful of services already do a narrow version of this (`auth.service.ts`, `invitation.service.ts`, `creator-registration.service.ts` pass `queryRunner.manager` into `AuthService.createUser` for their own multi-statement account-creation transactions). Generalizing this pattern to every tenant-scoped read and write means changing the signature of every method on every one of the 70 files, and every call site that calls them, including cross-service calls.

Rejected for the same reason as Option A, more severely: this is the single largest blast radius of any option considered, and it is also the easiest to get silently wrong -- a developer who forgets to pass the manager through one new method six months from now gets a connection with no tenant context and (today) no error, no test failure, just occasionally-wrong data. This is the opposite of what ADR-0002 promised: isolation enforced by the database so a forgotten filter fails safe, not a convention a developer must remember on every new line of code.

**Option C (chosen) -- pin the connection via `AsyncLocalStorage`, patched into the repository layer itself, so `@InjectRepository` call sites do not change.**

`AsyncLocalStorage` (Node's built-in mechanism, `node:async_hooks`) lets a value be attached to the current asynchronous call stack -- set once at the top of a request, and transparently readable by any `await`-chained code underneath it, with no explicit parameter passing and no DI scope change. If the repository layer itself is taught to check "is there a pinned connection for the current async context? if so, use it; if not, fall back to the pool as today," then every one of the 70 files keeps its existing `@InjectRepository(Entity)` constructor, unchanged, and the pinning becomes a property of *how a request is handled*, not *how a service is written*.

Building this patch by hand means intercepting every shape TypeORM's `Repository`/`EntityManager`/`QueryBuilder` exposes (`.find`, `.save`, `.query`, `.createQueryBuilder()`, nested relation loads, streaming) and getting every one of them right, in the exact code path ADR-0002 calls the whole tenant-isolation guarantee's chokepoint. Getting this subtly wrong -- one method shape that doesn't get redirected to the pinned connection -- is precisely a cross-tenant leak, the specific failure NFR-16 is written to make structurally impossible, not merely unlikely. Aurora is a five-person team shipping a pilot; writing and maintaining this patch in-house, in this one specific spot, is a worse risk than depending on a small, widely-used community library that already does exactly this and is exercised in production by many other Nest + TypeORM applications: **`typeorm-transactional`** (an `AsyncLocalStorage`-based patch over `EntityManager`/`Repository`/`QueryBuilder` that transparently joins an active transaction when one exists for the current async context, with no change to how a repository is injected or called). This ADR adopts it as the patch mechanism, named explicitly so a future reviewer can check it, not treat it as a black box; whoever implements this should read its source before pinning a version, given where it sits.

Using it means a per-request pin is, mechanically, a per-request **transaction** -- the library's primitive is "run this callback inside a transaction, routing every patched repository/manager call issued underneath it to that transaction's connection." There is no "pin a connection without opening a transaction" mode available off the shelf. This is an accepted, disclosed consequence (see below), not an oversight: it is the price of Option C's main benefit (zero changes to the 70 existing call sites).

### Where in the pipeline the pin has to start

Since (per problem 2 above) `req.user` and the resolved, validated account id are only available after `JwtAuthGuard` and `RolesGuard` have both run, the pin cannot start in middleware. NestJS **interceptors** run strictly after all guards, regardless of guard registration order, and can wrap the entire downstream handler call (the `Observable` returned by `next.handle()`) -- which maps directly onto "open the connection and set the variable before the handler runs; commit on success; roll back and release on error; never leak into the next request." This ADR replaces `TenantContextMiddleware` (deleted, not merely moved) with a NestJS interceptor, registered via `APP_INTERCEPTOR`, which runs after `JwtAuthGuard` and `RolesGuard` in every case, by framework design, not by careful ordering of an array.

## Decision

**Replace the never-registered `TenantContextMiddleware` with a `TenantContextInterceptor`, registered globally via `APP_INTERCEPTOR`, that pins each request's downstream database access to one connection using `typeorm-transactional`'s `AsyncLocalStorage` context, set from the account id `RolesGuard` has already resolved and validated -- not re-derived from headers.**

Concretely, the following files change. This is a specification for backend-dev to implement, not implementation code; pseudocode below is illustrative of intent and sequencing, not a diff.

1. **`src/common/middleware/tenant-context.middleware.ts` -- deleted.** Its two `SET LOCAL` statements are correct and move, unchanged in SQL, into the new interceptor below. Nothing else in the codebase imports this class (confirmed by grep), so deleting it is safe.

2. **New file: `src/common/tenant-context/tenant-context.runner.ts`.** A small injectable wrapper around `typeorm-transactional`'s API, so the rest of the codebase depends on an Aurora-named abstraction rather than the third-party package directly -- the same "wrap the variable thing behind our own interface" convention this codebase already uses for its pluggable adapters (ADR-0021's content-safety adapter, ADR-0051's OAuth/audience-insights adapters). Sketch of its shape:

   ```
   class TenantContextRunner {
     runAsAccount<T>(accountId: string, work: () => Promise<T>): Promise<T> {
       // runInTransaction(...): opens a queryRunner, starts a transaction,
       // and sets the AsyncLocalStorage context so every patched
       // Repository/EntityManager call issued inside `work` resolves to
       // this queryRunner's connection instead of checking one out of the
       // pool. Issues `SET LOCAL app.current_account_id = $1` with
       // [accountId] as a bound parameter (never string-interpolated --
       // accountId is already UUID-validated by RolesGuard/AccountAccessService
       // before this is called) as the first statement inside that
       // transaction, before `work()` runs. Commits on success, rolls back
       // and releases the connection on any thrown error, in all cases.
     }

     runAsCreatorPortal<T>(work: () => Promise<T>): Promise<T> {
       // Same shape; issues `SET LOCAL app.creator_portal = 'true'` instead.
       // Preserves the existing escape-hatch semantics exactly as written
       // in every migration's `OR current_setting('app.creator_portal', true)
       // = 'true'` branch -- no migration SQL changes as part of this ADR.
     }
   }
   ```

3. **New file: `src/common/interceptors/tenant-context.interceptor.ts`.** Reads the two signals that are reliably populated by the time an interceptor runs (after both global guards), and does not re-derive the account id from `X-Account-Id` or `user.currentAccountId` itself -- that resolution, including the agency-operator-vs-admin distinction and the "does this user actually have a relationship to this account" check, is `RolesGuard`'s job (ADR-0003) and must not be duplicated or second-guessed here, only consumed:

   ```
   class TenantContextInterceptor implements NestInterceptor {
     intercept(context, next) {
       const request = context.switchToHttp().getRequest();
       const user = request.user;
       const accountId = request.currentAccountId; // set by RolesGuard, already validated

       if (user?.isCreator) {
         return fromPromiseWork(() =>
           this.tenantContextRunner.runAsCreatorPortal(() => toPromise(next.handle())));
       }
       if (accountId) {
         return fromPromiseWork(() =>
           this.tenantContextRunner.runAsAccount(accountId, () => toPromise(next.handle())));
       }
       // Neither a creator token nor a resolved account id (a @Public() route,
       // or any other route RolesGuard legitimately let through with no
       // account context). Proceed on the default pool, unpinned. A
       // tenant-scoped table queried from this path still returns zero
       // rows, correctly, because no session variable is set -- this is
       // fail-closed, not an opened hole.
       return next.handle();
     }
   }
   ```
   The `fromPromiseWork`/`toPromise` bridging between the `Observable` that `next.handle()` returns and the `Promise`-shaped transaction wrapper is a real implementation detail (likely `rxjs`'s `defer` plus `lastValueFrom`, or calling the library's lower-level start/commit primitives directly instead of its single-callback helper) left to backend-dev to resolve against the actual library API at implementation time; it is flagged here rather than specified because it is API plumbing, not a design decision.

4. **`src/app.module.ts` -- no `NestModule`/`configure()` needed.** This was the anticipated one-line fix and is explicitly not what this ADR specifies, for the reasons above. Instead, add one entry to the existing `providers` array, alongside the two existing `APP_GUARD` entries:
   ```
   providers: [
     { provide: APP_GUARD, useClass: JwtAuthGuard },
     { provide: APP_GUARD, useClass: RolesGuard },
     { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
   ]
   ```
   `APP_INTERCEPTOR` imported from `@nestjs/core` alongside the existing `APP_GUARD` import. Ordering within `providers` does not matter for correctness here (interceptors always run after all guards by pipeline phase, not array position) but keeping it listed after the guards documents the intended sequencing for a future reader.

5. **New, small, `@Global()` module** (either added to `src/common/common.module.ts` or a new `src/common/tenant-context/tenant-context.module.ts` imported by `AppModule`, mirroring `CommonModule`'s own documented reason for being `@Global()`: `APP_INTERCEPTOR`, like `APP_GUARD`, is instantiated in `AppModule`'s own injector context and can only resolve providers declared there or exported by a global module). Provides and exports `TenantContextRunner` and `TenantContextInterceptor`.

6. **`src/main.ts`.** After `const app = await NestFactory.create(AppModule, ...)` and before `app.listen(...)`: call the library's `initializeTransactionalContext()` once, then `addTransactionalDataSource(app.get(DataSource))` once, patching the bootstrapped `DataSource` for the lifetime of the process. This is a one-time process-level setup step, not per-request.

7. **TypeORM pool size, `app.module.ts`'s `TypeOrmModule.forRootAsync` factory.** Add an explicit `extra: { max: <N> }` (currently unset, meaning the driver default, 10 for `pg`). See "Connection pool sizing" below for why this now matters in a way it did not before.

**This ADR does not touch `RolesGuard`.** `request.currentAccountId`, which this interceptor consumes, is only set correctly if `RolesGuard` itself fails closed when no account context resolves -- today it does not (it returns `true`), which is a second, independent bug fixed by ADR-0064. See "Relationship to ADR-0064" below for why these are two ADRs, not one.

### Connection pool sizing

Before this fix, a connection is checked out of the pool for the duration of a single query and immediately returned. After this fix, for any request that resolves to an account or creator-portal context, a connection is checked out for the **entire duration of the request** (every downstream service call, however many, until the response is sent). This is a real, new constraint on a finite resource that did not meaningfully exist before, and it is the direct cost of Option C's main benefit.

NFR-07 states a pilot-scale target of 200 concurrent creator sessions and 20 concurrent brand sessions. That is a session count, not a simultaneous in-flight-request count -- the overwhelming majority of an open session is idle, between requests, holding no connection. NFR-04 bounds how long a request that *is* in flight holds its connection (reads p95 <= 500ms, writes p95 <= 1500ms). Combining the two: the realistic peak number of connections held at any one instant is bounded by how many requests are actually in flight at once, not by session count, and should be comfortably within a double-digit pool size at pilot scale. The TypeORM pool must be explicitly sized (`extra.max`) rather than left at the driver default of 10, and the Bull job workers (see "Known gap," below) draw from the same Postgres `max_connections` ceiling (default 100) when they run, so the two must be sized together, not independently. This ADR does not pick a specific number -- that is a capacity-planning exercise for whoever implements it, informed by actual pilot traffic -- but it specifies that picking one, explicitly, is part of this fix, not an unrelated follow-up, and that pool-utilization should be added to the NFR-31 observability set as a follow-up metric, since exhausting it now fails every request, not just tenant-scoped ones.

### Known gap this ADR does not close: Bull job processors

70 files touch `@InjectRepository`/`DataSource`; a meaningful subset of them are Bull queue processors (`run-safety-check.processor.ts`, `attempt-payout-execution.processor.ts`, `generate-shortlist.processor.ts`, `generate-campaign-report.processor.ts`, and others), which execute jobs consumed from Redis, entirely outside the HTTP request lifecycle this interceptor hooks into. No guard, no interceptor, and therefore no pin from this ADR ever runs for them. Today, with RLS never engaged at all, this is not a regression -- processors run exactly as they always have, with no account context, same as every other connection. After this ADR, it remains exactly as it is today for processors specifically: unpinned, unaffected, not made worse and not made better. Closing this is a distinct, same-shaped follow-up (a small wrapper invoked at the top of each processor's `process()` method, using the job payload's own stored account id, calling the same `TenantContextRunner`) and is explicitly out of scope for this ADR, named here rather than silently left for a future reviewer to rediscover, consistent with this project's own convention (ADR-0062 did the same for `audit_log`'s write-side risk).

### Relationship to ADR-0064

This ADR and ADR-0064 fix two different bugs in two different pipeline phases, and each is necessary but not sufficient on its own:

- This ADR (the interceptor) makes RLS actually engage for any request that reaches it with a resolved account id or creator flag. It does **not** stop an unauthorized request from reaching a controller in the first place -- that is `RolesGuard`'s job, and today `RolesGuard` has its own bug (returns `true` whenever it cannot resolve an account id, which is also true for a legitimate creator token *and* for a brand-scoped route hit by a creator token with no `X-Account-Id`). Fixing only this ADR would make RLS engage correctly for every request RolesGuard already lets through today, including the exploit case -- the exploit's request would simply reach the controller with `request.currentAccountId` unset, `user.isCreator` true, and this interceptor would (correctly, per its own logic) set `app.creator_portal = 'true'`, which is the wrong context for a brand-scoped table's RLS policy to see, since that escape hatch exists for the E3 creator-touched tables specifically, not arbitrary brand-scoped ones -- some brand tables have no such OR-branch and would correctly return zero rows, but any table that does have one would not be protected by RLS from this specific exploit.
- ADR-0064 (RolesGuard) makes a creator-portal token hitting a brand-scoped route get a `403` before ever reaching a controller, closing the authorization bypass. It does **not**, on its own, make RLS engage for any legitimately-resolved request -- without this ADR, every query from every properly-authorized request still runs on an unpinned pool connection, and RLS returns zero rows for everyone, not just attackers, which would look like the application silently losing all its data rather than enforcing a boundary.

Both must ship together for NFR-16 to actually hold end to end.

## Consequences

**What Aurora gains:**
- ADR-0002's own stated design -- "a repository layer sets the tenant context at connection checkout, so a handle without one cannot be obtained" -- becomes true at runtime for the first time since E1, for every one of the 70 files using the standard `@InjectRepository`/`DataSource` pattern, with zero changes to any of those 70 files' constructors or method signatures.
- The fix lives at exactly one new chokepoint (the interceptor) plus one new, named, swappable dependency (the patch library wrapped behind `TenantContextRunner`), both reviewable in a single pull request, rather than touching every service in the codebase.
- ADR-0062's `audit_log` read policy, and every other tenant-isolation policy written since E1, stop being correctly-specified-but-inert and become the platform's actual, enforced tenant boundary, matching every epic summary's stated expectation of what "fixing this" would mean.

**What Aurora gives up:**
- A connection is now held for the full duration of any request that resolves to an account or creator context, not just for the duration of a query. This is a new, finite-resource constraint that must be sized (pool size) and watched (a new observability item) going forward; it was not a consideration before this fix because no request ever held a connection for longer than a single statement.
- Aurora now depends on a third-party library (`typeorm-transactional`) sitting directly in the tenant-isolation chokepoint, rather than on TypeORM's own documented public API alone. The alternative -- writing and maintaining the equivalent `AsyncLocalStorage`-patch by hand -- was judged a worse risk for a five-person team in exactly this one spot, but it is a real dependency, and its exact version should be pinned and its relevant source read, not installed on trust, given what it sits underneath.
- Bull job processors remain unpinned and unprotected by RLS after this ADR, exactly as they are today -- a disclosed, not-closed gap, not a regression.
- The two services that open their own explicit multi-statement transactions via a directly-created `queryRunner` for reasons unrelated to tenant context (`auth.service.ts`'s registration flow, `invitation.service.ts`'s invitation-accept flow, `creator-registration.service.ts`) will, for the one request that hits each of them, hold two connections simultaneously: the interceptor's pinned one (idle, holding only the session variable) and their own. This is a minor additional pool-pressure cost, bounded to a small, enumerable, low-traffic set of account-creation-time endpoints, not a correctness problem.

**Risks:**
- If the library's patch misses a TypeORM call shape Aurora actually uses somewhere in the 70 files (an unusual raw-query pattern, a streaming query, a QueryBuilder edge case), that one call site silently keeps running on an unpinned pool connection -- which, under `FORCE ROW LEVEL SECURITY`, fails closed (zero rows, not another tenant's rows), so the failure mode is "this feature appears broken" rather than "data leaked." This is the right failure direction for NFR-16, but it will need a real test (see below) to catch rather than a user noticing a feature stopped returning data.
- Holding one connection per in-flight request means a traffic spike or a slow downstream call (e.g., a brand-safety check awaiting an adapter response mid-request) now also holds a database connection for that same duration, which could, if undersized, cause requests to queue waiting for a pool slot -- a new coupling between unrelated subsystems' latency and database availability that did not exist before. Mitigated by explicit, deliberate pool sizing as part of this fix, not left to the default.

## Acceptance tests this fix needs, and whether they can be mocked

Stated plainly, because the honest answer matters more here than anywhere else in this ADR: **the actual claim this fix makes -- that PostgreSQL itself returns only the correct tenant's rows -- cannot be proven by a unit test against a mocked `DataSource`.** A mock can only assert that the interceptor *calls* `queryRunner.query('SET LOCAL app.current_account_id = $1', [accountId])` with the right argument in the right branch; it cannot assert that Postgres's RLS engine then actually filters rows on a real connection, because there is no Postgres underneath a mock. Both kinds of test are needed, and they prove different things:

**Unit/mock-level (fast, runs in the existing Vitest suite, no real database):**
- `TenantContextInterceptor`, given a mocked request with `user.isCreator = true`, calls `runAsCreatorPortal` and not `runAsAccount`.
- Given a mocked request with `request.currentAccountId` set and `user.isCreator` falsy, calls `runAsAccount` with exactly that id, not a value re-read from `X-Account-Id` or `user.currentAccountId` directly (this specifically guards against the interceptor silently re-implementing RolesGuard's resolution instead of trusting it).
- Given neither, calls neither, and still calls `next.handle()` (the public-route fail-open-to-fail-closed path).
- These tests prove the chokepoint is wired correctly. They do not, and cannot, prove tenant isolation holds.

**Integration-level, against a real PostgreSQL instance (this is the only way to prove the actual claim, and it genuinely requires a real database, not a mock):**
- Run the real migrations against an ephemeral Postgres (a `testcontainers`-managed instance, or a docker-compose Postgres service added to CI for this test specifically -- this fix's own QA step should stand this up even minimally, rather than defer it, since without it there is no way to verify this fix does what it claims, mocked or otherwise). This repository has no such harness today (a separately-tracked, known gap); this ADR's QA step is the first thing that actually needs one.
- Seed one tenant-scoped table (e.g., `brand_profile`) with rows under two different `account_id` values. Drive a request through the real interceptor and a real `@InjectRepository`-backed repository (not a raw queryRunner) scoped to account A. Assert: exactly account A's rows come back, never account B's, under a single request.
- Drive a request with no resolvable account id and no creator flag through the same repository against the same table. Assert: zero rows, not an error, not all rows -- this is the specific fail-closed property NFR-16 depends on.
- Drive two near-simultaneous requests, one scoped to account A and one to account B, against a deliberately small pool (2-3 connections) sized smaller than the number of concurrent requests in the test, forcing connection reuse. Assert neither request's query ever sees the other's `current_setting('app.current_account_id')` value -- this is the specific "no leakage across a released, reused pooled connection" property called out as a requirement for this fix, and it is the one property this whole ADR exists to guarantee; a test that does not force pool reuse under concurrency does not actually test it.
- Repeat the creator-portal case against a creator-touched table carrying the `OR app.creator_portal = 'true'` branch, confirming the escape hatch still works unchanged.

If a real-Postgres integration suite does not exist by the time this ships, the honest status of this fix is "specified and unit-tested, but not proven" -- that should be stated in the implementation's own QA summary in exactly those terms, not implied to be fully verified when it is not.
