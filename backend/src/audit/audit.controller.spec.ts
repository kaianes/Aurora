import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuditController } from './audit.controller';

// FR-60, section 5.4 of the E9 architecture doc. The controller is a thin
// wrapper: it forwards the resolved currentAccountId (set upstream by
// RolesGuard from the caller's own X-Account-Id/membership, never read
// directly off the request body) along with cursor/limit to
// AuditService.listForAccount. Tenant isolation itself is tested in
// audit.service.spec.ts and by RolesGuard's own tests; this spec only
// covers the wiring.
describe('AuditController - FR-60', () => {
  let controller: AuditController;
  let auditService: { listForAccount: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    auditService = { listForAccount: vi.fn() };
    controller = new AuditController(auditService as any);
  });

  function reqWith(accountId: string) {
    return { currentAccountId: accountId } as any;
  }

  it('forwards the resolved account, cursor, and limit to the service', async () => {
    auditService.listForAccount.mockResolvedValue({
      data: [],
      pagination: { next_cursor: null, has_more: false },
    });

    const result = await controller.list('8810', '50', reqWith('acct-1'));

    expect(auditService.listForAccount).toHaveBeenCalledWith('acct-1', '8810', 50);
    expect(result).toEqual({ data: [], pagination: { next_cursor: null, has_more: false } });
  });

  it('defaults limit to 20 when not provided', async () => {
    auditService.listForAccount.mockResolvedValue({ data: [], pagination: { next_cursor: null, has_more: false } });

    await controller.list(undefined as any, undefined as any, reqWith('acct-1'));

    expect(auditService.listForAccount).toHaveBeenCalledWith('acct-1', undefined, 20);
  });

  // ---- FR-60 scenario 2, at the wiring level: the controller always
  // forwards whatever currentAccountId RolesGuard resolved for this caller,
  // never a fixed or client-supplied value -- so a request for a client the
  // caller cannot access never even reaches this handler (RolesGuard
  // refuses it first, logged as authorization.denied). ----
  it('scopes the request to whatever currentAccountId was resolved for this caller', async () => {
    auditService.listForAccount.mockResolvedValue({ data: [], pagination: { next_cursor: null, has_more: false } });

    await controller.list(undefined as any, undefined as any, reqWith('acct-client-a'));

    expect(auditService.listForAccount).toHaveBeenCalledWith('acct-client-a', undefined, 20);
  });
});
