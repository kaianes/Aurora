import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../common/guards/roles.guard';
import { AgencyClientReportController } from './agency-client-report.controller';
import { Role } from '../database/entities';

// US-43 scenario 3, exercised at the actual, already-live point of refusal:
// RolesGuard + AccountAccessService, which is what a real request to
// POST/GET /agency/clients/:clientAccountId/reports hits before
// AgencyClientReportController or ClientReportService ever run.
//
// docs/architecture/e7-analytics-reporting.md section 5.5 documents a 404
// CLIENT_NOT_FOUND response for "clientAccountId does not resolve under the
// caller's current tenant context (covers both... not accessible to this
// caller)". The actual, already-live implementation (RolesGuard calling
// AccountAccessService.resolveAccess, the same resolution path this repo's
// "fix: cross-tenant data leak" commit put in place) refuses with a 403
// INSUFFICIENT_PRIVILEGES
// before the request reaches the controller at all, for exactly the two
// cases scenario 3 names: a client account outside the caller's granted
// access, and a client account outside the caller's workspace entirely
// (resolveAccess returns null in both cases, since it cannot find a
// workspace-matching, access-granted relationship -- see
// account-access.service.ts). stories.md's own acceptance criterion for
// scenario 3 names no specific status code ("the system refuses the request
// and does not return any figures for that client"), so the 403-at-the-guard
// behavior fully satisfies the acceptance criterion as written. This test
// documents that the *actual* status code is 403, not architecture section
// 5.5's documented 404 -- a documentation-vs-implementation inconsistency to
// flag back to backend-dev / the architecture doc's own maintainer, not an
// implementation bug to fix, since both the guard and ClientReportService's
// own narrower 404 (see client-report.service.spec.ts) independently
// satisfy the behavioral requirement.
describe('US-43 scenario 3 -- actual refusal behavior for an inaccessible client (doc vs implementation)', () => {
  let guard: RolesGuard;
  let auditService: { log: ReturnType<typeof vi.fn> };
  let accountAccessService: { resolveAccess: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    auditService = { log: vi.fn() };
    accountAccessService = { resolveAccess: vi.fn() };
    guard = new RolesGuard(new Reflector(), auditService as any, accountAccessService as any);
  });

  function makeContext(accountId: string, requiredRoles: Role[]) {
    const request = {
      headers: { 'x-account-id': accountId, 'user-agent': 'test' },
      user: { sub: 'user-renata', memberships: [{ account_id: 'acct-agency-home', role: Role.AGENCY_OPERATOR }] },
      url: '/v1/agency/clients/acct-not-granted/reports',
      method: 'POST',
      ip: '127.0.0.1',
    };
    return {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => AgencyClientReportController.prototype.requestReport,
      getClass: () => AgencyClientReportController,
    } as any;
  }

  it('refuses with 403 INSUFFICIENT_PRIVILEGES, not a 404, for a client the operator has no operator_client_access grant for', async () => {
    accountAccessService.resolveAccess.mockResolvedValue(null); // no relationship resolves at all

    const context = makeContext('acct-not-granted', [Role.AGENCY_ADMIN, Role.AGENCY_OPERATOR]);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      response: { error: { code: 'INSUFFICIENT_PRIVILEGES' } },
    });
  });

  it('refuses with 403, not a 404, for a client account outside the caller agency workspace entirely', async () => {
    // resolveAccess's own workspace-matching check (account-access.service.ts)
    // returns null for a target account whose workspace never matches any of
    // the caller's agency memberships' home-account workspace.
    accountAccessService.resolveAccess.mockResolvedValue(null);

    const context = makeContext('acct-other-workspace-entirely', [Role.AGENCY_ADMIN, Role.AGENCY_OPERATOR]);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('logs the authorization denial distinctly, so the refusal is auditable even though no figures are ever queried', async () => {
    accountAccessService.resolveAccess.mockResolvedValue(null);
    const context = makeContext('acct-not-granted', [Role.AGENCY_ADMIN, Role.AGENCY_OPERATOR]);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);

    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'authorization.denied', metadata: expect.objectContaining({ reason: 'no_account_relationship' }) }),
    );
  });
});
