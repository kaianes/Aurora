import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable, defer, lastValueFrom } from 'rxjs';
import { TenantContextRunner } from '../tenant-context/tenant-context.runner';

// Runs strictly after JwtAuthGuard and RolesGuard (NestJS's own pipeline
// order, not careful array placement), so request.user and
// request.currentAccountId are both reliably populated, when they resolve
// at all, by the time this runs (ADR-0063). Does not re-derive the account
// id from X-Account-Id or user.currentAccountId itself -- that resolution,
// including the agency-operator-vs-admin distinction and the
// "does this user actually have a relationship to this account" check, is
// RolesGuard's job (ADR-0003/ADR-0064) and must not be duplicated or
// second-guessed here, only consumed.
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  constructor(private tenantContextRunner: TenantContextRunner) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const accountId = request.currentAccountId; // set by RolesGuard, already validated

    // next.handle() returns a "cold" Observable: nothing downstream runs
    // until it is subscribed. Wrapping the subscription itself (via
    // lastValueFrom, inside a Promise-returning callback) in
    // TenantContextRunner's transaction, rather than calling next.handle()
    // eagerly and only wrapping the resulting promise, matters here: it is
    // what makes every downstream repository/query call -- not just the
    // interceptor's own code -- execute inside the pinned transaction's
    // AsyncLocalStorage context. defer(...) re-wraps that promise back into
    // an Observable so this interceptor still returns the Observable shape
    // Nest's pipeline expects of intercept(), without eagerly starting the
    // transaction at subscribe-construction time instead of at subscribe
    // time.
    if (user?.isCreator) {
      return defer(() =>
        this.tenantContextRunner.runAsCreatorPortal(() => lastValueFrom(next.handle())),
      );
    }

    if (accountId) {
      return defer(() =>
        this.tenantContextRunner.runAsAccount(accountId, () => lastValueFrom(next.handle())),
      );
    }

    // Neither a creator token nor a resolved account id (a @Public() route,
    // or any other route RolesGuard legitimately let through with no
    // account context). Proceed on the default pool, unpinned. A
    // tenant-scoped table queried from this path still returns zero rows,
    // correctly, because no session variable is set -- this is fail-closed,
    // not an opened hole.
    return next.handle();
  }
}
