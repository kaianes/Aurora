# ADR-0064: RolesGuard Fails Closed When No Account Context Resolves

**Status:** Proposed
**Date:** 2026-10-25
**Epic:** Cross-cutting -- Tenant Isolation Remediation (identified alongside ADR-0063; same remediation effort, different pipeline phase)
**Governs:** NFR-16, NFR-17, FR-04, FR-07
**Related:** ADR-0063 (tenant context engagement). Both are required together; see ADR-0063's "Relationship to ADR-0064" for why this is a separate ADR rather than folded into that one.

## Context

`RolesGuard` (`src/common/guards/roles.guard.ts`) is the single place ADR-0003 designed to enforce "every account-scoped route must resolve to a real relationship between this user and the target account, regardless of whether it also requires specific roles." Its first line of logic, today:

```
const accountId = request.headers['x-account-id'] || user?.currentAccountId;
if (!accountId) {
  return true;
}
```

with a comment claiming this is safe because "only creator-portal routes legitimately lack an account id." Checking that claim against the rest of the authorization pipeline directly, rather than accepting the comment, finds it is only half true, and the half that is false is a live authorization bypass:

**There are, in fact, two different reasons `accountId` can be falsy here, and the guard currently cannot tell them apart:**

1. **A genuine creator-portal route.** `jwt.strategy.ts` sets `isCreator: true` on every creator JWT's validated payload; creators carry no `Membership` row and no `currentAccountId`, by design (ADR-0003, E3 architecture doc section 2.3). Every creator-portal controller already applies `@UseGuards(CreatorAuthGuard)` (`src/matching/creator-auth.guard.ts`) at the route level, and that guard's own comment says explicitly that `RolesGuard` "would otherwise allow any authenticated user through since creator-portal routes carry no `@Roles` decorator" -- the author of that guard already understood `RolesGuard` needs to get out of the way for *these specific routes*, not for anyone holding a particular kind of token.

2. **A non-creator, authenticated user hitting a brand- or agency-scoped route with no `X-Account-Id` header and no `currentAccountId` claim.** Nothing about this case is safe to wave through. Today, it is: a creator-portal JWT (which satisfies neither the `brand_owner`/`agency_admin`/etc. role checks nor has any membership anywhere) sent at a brand-scoped endpoint with no `X-Account-Id` header hits the exact same `if (!accountId) return true` branch as case 1, and sails through with **no role check, no account-relationship check, and no audit log entry**, because the guard cannot distinguish "this request is hitting one of the small, specific set of routes that are legitimately not account-scoped" from "this is anyone, and nobody told me which account they mean." The comment's justification ("only creator-portal routes legitimately lack an account id") describes routes; the code checks a value that happens, today, to correlate with those routes for one specific caller shape, but does not actually identify them.

**A naive fix -- throw whenever `accountId` is falsy -- breaks a third, legitimate case the current code also (accidentally) handles correctly: `@Public()` routes.** `JwtAuthGuard` checks the `IS_PUBLIC_KEY` reflector metadata and skips Passport entirely for `@Public()` routes (`src/auth/auth.controller.ts`, `invitation.controller.ts`, `pricing.controller.ts`, `creator-registration.controller.ts`, `creator-claim.controller.ts`, `social-account.controller.ts`'s OAuth callback method, `public-client-report.controller.ts`), which means `request.user` is `undefined` for those routes by the time `RolesGuard` runs -- `RolesGuard` itself has no `@Public()` awareness of its own today, and only happens to let these routes through because `accountId` is falsy for them too, by the same accident that lets the exploit case through. This was checked directly against `JwtAuthGuard`'s and `Public()`'s actual source, not assumed.

**A second naive fix -- check `user?.isCreator` and treat it as an unconditional pass -- was drafted, checked against the actual exploit it is meant to close, and found not to close it.** The stated vulnerability is specifically "a creator-portal JWT... bypass[es] role checks entirely on brand-scoped routes." Returning `true` whenever `user.isCreator` is true, regardless of which route is being hit, does not fix that: it is still true for a creator JWT pointed at a brand-scoped, `@Roles()`-protected endpoint. It would narrow today's bug considerably (an ordinary authenticated brand/agency user with a missing header would now correctly be rejected, which is a real improvement), but the exact scenario named in this remediation effort's own framing -- a creator JWT reaching a brand-scoped route and skipping its role check -- would remain exactly as open as it is today, only reachable by a narrower set of tokens. A fix that still leaves the named exploit open is not a fix, however much it shrinks the surface around it; this is recorded here, rather than silently discarded, because it is exactly the kind of plausible-looking-but-insufficient fix a future reviewer might reach for again if this file is touched without reading this ADR first.

The reason neither "check a value" nor "check a token claim" can work is the same in both cases: **the thing that is actually safe to exempt is a specific, small set of *routes* (the ones already protected by `CreatorAuthGuard`, which do their own, correct, route-appropriate check), not any property of the *caller* or of a *header***. `RolesGuard` needs to be told, explicitly, "this route is not account-scoped," the same way it is already told "this route is fully public" via `@Public()`. No metadata saying that exists today.

Two ways to supply that metadata were considered:

- **A new decorator, `@CreatorPortalRoute()`, applied at every call site that currently carries `@UseGuards(CreatorAuthGuard)`.** Explicit, visible at each call site, checked via the same `Reflector` mechanism already used for `@Roles()` and `@Public()`. Cost: every one of the existing creator-portal controllers gains one more decorator line, enumerated exactly below -- a real, nonzero blast radius, but a bounded, enumerable, mechanically-checkable one (13 call sites across 9 files, all already carrying `@UseGuards(CreatorAuthGuard)`, found by one grep), nothing like the 70-file concern ADR-0063 weighed for its own, much larger decision.
- **Read NestJS's internal per-route guard list via `Reflector` (the metadata key `@UseGuards()` writes under the hood) and check whether `CreatorAuthGuard` is present in it, with no new decorator at all.** Zero new call-site changes. Rejected: this depends on an internal, undocumented Nest metadata key rather than a first-class, intentional contract -- a Nest version upgrade that changes how `@UseGuards()` stores its metadata would silently break this exact check, in the exact file responsible for a "promise holds" NFR, with no compiler error and no test failure pointing at the cause. Explicit metadata this codebase owns and controls is worth thirteen decorator lines.

## Decision

**Add a new route-level decorator, `@CreatorPortalRoute()`, and apply it at every existing `@UseGuards(CreatorAuthGuard)` call site. `RolesGuard.canActivate` checks, in order: `@Public()` metadata, then `@CreatorPortalRoute()` metadata, then requires a resolvable `accountId`, throwing (and logging the denial) if none of the first two apply and the third is absent.**

1. **New file: `src/common/decorators/creator-portal-route.decorator.ts`.**
   ```
   export const CREATOR_PORTAL_ROUTE_KEY = 'creatorPortalRoute';
   export const CreatorPortalRoute = () => SetMetadata(CREATOR_PORTAL_ROUTE_KEY, true);
   ```
   Re-exported from `src/common/decorators/index.ts`, alongside the existing `Public`/`IS_PUBLIC_KEY` export, in the same style.

2. **`src/common/guards/roles.guard.ts`.** Sketch of the corrected logic (illustrative; not a diff):
   ```
   async canActivate(context): Promise<boolean> {
     const request = context.switchToHttp().getRequest();

     const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
       context.getHandler(), context.getClass(),
     ]);
     if (isPublic) {
       return true; // unchanged behavior, now explicit instead of accidental
     }

     const isCreatorPortalRoute = this.reflector.getAllAndOverride<boolean>(
       CREATOR_PORTAL_ROUTE_KEY,
       [context.getHandler(), context.getClass()],
     );
     if (isCreatorPortalRoute) {
       // This route's real authorization is CreatorAuthGuard's job, applied
       // at the same call site. RolesGuard has nothing to check here --
       // creators carry no membership/role for resolveAccess to evaluate --
       // regardless of what accountId, if any, happens to be present on
       // the request. A route not carrying this decorator gets no such
       // exemption, no matter what the caller's token looks like.
       return true;
     }

     const user = request.user;
     const accountId = request.headers['x-account-id'] || user?.currentAccountId;
     if (!accountId) {
       await this.auditService.log({
         actorUserId: user?.sub,
         targetAccountId: undefined,
         action: 'authorization.denied',
         metadata: {
           reason: 'no_account_context',
           endpoint: request.url,
           method: request.method,
         },
         ipAddress: request.ip,
         userAgent: request.headers['user-agent'],
       });
       throw new ForbiddenException({
         error: {
           code: 'INSUFFICIENT_PRIVILEGES',
           message: 'Voce nao tem permissao para realizar esta acao.',
           details: {},
         },
       });
     }

     // ...existing resolveAccess / role-check logic, unchanged from here down.
   }
   ```
   `Reflector` is already injected into this guard (for `@Roles()`); no new constructor dependency.

3. **Every existing `@UseGuards(CreatorAuthGuard)` call site gains `@CreatorPortalRoute()` at the same level (class or method) it is currently applied at.** Found by grepping `CreatorAuthGuard` usage directly, not estimated:
   - Class-level (add immediately alongside the existing `@UseGuards(CreatorAuthGuard)` class decorator):
     - `src/creator-network/media-kit.controller.ts`
     - `src/creator-network/rate-preference.controller.ts`
     - `src/creator-network/onboarding.controller.ts`
     - `src/payments/creator-portal-payout.controller.ts`
     - `src/analytics/creator-portal-performance.controller.ts`
     - `src/content-workflow/creator-portal-briefing.controller.ts`
     - `src/content-workflow/creator-portal-content-submission.controller.ts`
   - Method-level (these two controllers apply `CreatorAuthGuard` per-method, not per-class, and in one case the controller is mixed with a `@Public()` method that must **not** gain this decorator):
     - `src/matching/creator-portal.controller.ts` -- all three methods (`list`, `accept`, `decline`) already carry `@UseGuards(CreatorAuthGuard)`; add `@CreatorPortalRoute()` to each.
     - `src/creator-network/social-account.controller.ts` -- exactly the three methods already carrying `@UseGuards(CreatorAuthGuard)` (`authorize`, `list`, `disconnect`). The fourth method, `callback`, carries `@Public()` instead and already passes `RolesGuard` via the first check; it must not be given `@CreatorPortalRoute()` as well (harmless if it were, since `@Public()` is checked first and returns before this metadata is ever read, but the correct, intentional annotation is `@Public()` alone, matching what that route actually is).
   - This list is exhaustive against the current codebase (one grep, reproduced in this ADR's own investigation) but is not guaranteed to stay exhaustive: any future creator-portal controller must carry both `@UseGuards(CreatorAuthGuard)` and `@CreatorPortalRoute()`, and a missing second decorator fails closed (the new route gets a 403 for every creator request until someone notices and adds it) rather than failing open -- the correct direction for a mistake in this specific file.

**No change to anything below the existing `if (!resolvedRole)` check.** `AccountAccessService.resolveAccess`, the role-mismatch branch, and `request.currentAccountId`/`request.currentRole` assignment are untouched.

**This is independent of, and does not require, ADR-0063.** This fix closes the authorization bypass (an unauthorized request reaching a controller) regardless of whether RLS is engaged underneath it. ADR-0063 depends on this fix, though: its interceptor reads `request.currentAccountId` and `user?.isCreator`, both of which are only meaningful for a request that actually reached the interceptor having been correctly authorized by this guard first -- after this fix, a creator JWT only ever reaches the interceptor via a route that is both `@CreatorPortalRoute()`-decorated and `CreatorAuthGuard`-passed, so ADR-0063's own `user?.isCreator` check in the interceptor needs no further change.

## Consequences

**What Aurora gains:**
- The specific bypass named in this remediation effort's own framing -- a creator-portal JWT reaching a brand-scoped route and skipping its role check -- is actually closed, not merely narrowed. A creator JWT at any route other than the 13 enumerated, explicitly-marked creator-portal call sites is now subject to the exact same `accountId` resolution and `resolveAccess` check as any other caller, and fails it (no membership, no relationship), exactly as it should.
- Every denial this guard throws is now logged, including the new case, closing a gap where NFR-16's "every denied attempt logged" promise did not actually hold for this specific path (it was not a denial before -- it was a silent pass).
- `@Public()` and `@CreatorPortalRoute()` together make every exemption this guard grants a first-class, grep-able, reviewable fact about the route, declared where the route is defined, rather than inferred from runtime values that happened to correlate with the right routes under today's traffic but were never guaranteed to.

**What Aurora gives up:**
- Thirteen existing call sites each gain one additional decorator. This is a real, mechanical change across nine files, not a zero-diff fix -- smaller than ADR-0063's own blast-radius concerns, but not free, and worth stating plainly rather than understating it as "a guard tweak."
- A future creator-portal route that is added without both decorators fails closed for creators until someone notices (see "Risks"). This is the correct failure direction, but it is a real, ongoing discipline requirement, not a one-time fix that can never regress by omission.

**Risks:**
- A new creator-portal controller that copies an existing one's `@UseGuards(CreatorAuthGuard)` line but not its `@CreatorPortalRoute()` line (easy to miss if a developer copies from a routeâ€™s guard list without reading this ADR) will reject every creator request with a 403 until caught -- a visible, loud failure (every request to the new route fails in manual testing) rather than a silent one, which is the right direction for a mistake here, but it is worth a one-line callout in the pull request template or a lint rule pairing the two decorators, as a follow-up outside this ADR's own scope.
- This fix depends on the 13-site enumeration above staying accurate as the only inventory of creator-portal routes. The acceptance test below (a route-sweep) is the mechanical check that keeps this honest rather than relying on this ADR's own list being re-read by hand in the future.

## Acceptance tests

Unlike ADR-0063, this fix is fully provable as a unit/mock test -- `RolesGuard`'s own logic, not PostgreSQL's, is what is under test here, and `AccountAccessService`/`AuditService` are already mocked in this file's existing spec suite:

- A mocked request with no `user` and `@Public()` metadata present: `canActivate` returns `true`, `AuditService.log` is not called.
- A mocked request with `@CreatorPortalRoute()` metadata present and no `accountId` resolvable from either source: `canActivate` returns `true`, `AuditService.log` is not called, and `AccountAccessService.resolveAccess` is asserted not called -- this is the regression test for the legitimate creator-portal case, which must keep passing.
- A mocked request with **no** `@Public()` and **no** `@CreatorPortalRoute()` metadata, a creator-flavored `user` (`isCreator: true`), and no `X-Account-Id` header: `canActivate` throws `ForbiddenException`, `AuditService.log` is called exactly once with `metadata.reason === 'no_account_context'`, and `resolveAccess` is asserted not called. This is the actual regression test for the named exploit, and it is deliberately written against a route that is *not* decorated, which is the scenario the rejected `isCreator`-unconditional-bypass draft would have failed.
- A mocked request with neither decorator, a non-creator `user`, and no `X-Account-Id` header: same assertions as above -- confirms the ordinary (non-creator) version of the bug is also closed, not only the creator-specific framing.
- A mocked request with neither decorator, a resolvable `accountId`, and `resolveAccess` returning a falsy role: unchanged existing behavior (throws, logs `reason: 'no_account_relationship'`) -- a regression guard confirming the new branch did not disturb the existing one below it.
- **A route-sweep integration test, extending the one ADR-0003 already requires** ("every registered route hit with an unauthorized role expects a 403"): enumerate every registered route in the running application (Nest exposes this via its router introspection) and assert that every route carrying `@UseGuards(CreatorAuthGuard)` also carries `@CreatorPortalRoute()`, and vice versa. This is the test that keeps the 13-site list in this ADR from silently going stale as new creator-portal routes are added -- it fails the build the moment the two decorators diverge, rather than waiting for a tenth epic review to notice by hand.
