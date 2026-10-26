import { describe, it, expect, vi, beforeEach } from 'vitest';
import { of } from 'rxjs';
import { FinancialAccessAuditInterceptor } from './financial-access-audit.interceptor';

function mockContext(request: any, resource: string | undefined) {
  const reflector = { getAllAndOverride: vi.fn().mockReturnValue(resource) };
  const context: any = {
    getHandler: () => 'handler',
    getClass: () => 'class',
    switchToHttp: () => ({ getRequest: () => request }),
  };
  return { context, reflector };
}

function callHandler(response: any = {}) {
  return { handle: () => of(response) } as any;
}

// NFR-23: "access to creator financial data restricted by role and logged
// on every access." This is the first epic whose audit convention covers
// reads, not only writes -- this interceptor is the one mechanism that
// makes that structural rather than a per-handler convention someone could
// forget (section 4.1 of the E6 architecture doc).
describe('FinancialAccessAuditInterceptor - NFR-23', () => {
  let auditService: { log: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    auditService = { log: vi.fn().mockResolvedValue(undefined) };
  });

  it('logs a read-access entry on a successful GET carrying @AuditResource', async () => {
    const interceptor = new FinancialAccessAuditInterceptor({} as any, auditService as any);
    const request = {
      method: 'GET',
      params: { id: 'pay-001' },
      user: { sub: 'user-1', creatorId: 'creator-1' },
      currentAccountId: null,
      ip: '127.0.0.1',
      headers: { 'user-agent': 'vitest' },
    };
    const { context, reflector } = mockContext(request, 'payout_obligation');
    (interceptor as any).reflector = reflector;

    const observable = interceptor.intercept(context, callHandler({ id: 'pay-001' }));
    await new Promise<void>((resolve) => observable.subscribe({ complete: () => resolve() }));

    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'payout_obligation.accessed',
        actorUserId: 'user-1',
        metadata: expect.objectContaining({ resource_id: 'pay-001', creator_id: 'creator-1' }),
      }),
    );
  });

  it('does not log anything when the handler carries no @AuditResource metadata', async () => {
    const request = { method: 'GET', params: {}, user: {}, ip: '127.0.0.1', headers: {} };
    const interceptor = new FinancialAccessAuditInterceptor({} as any, auditService as any);
    const { context, reflector } = mockContext(request, undefined);
    (interceptor as any).reflector = reflector;

    const observable = interceptor.intercept(context, callHandler());
    await new Promise<void>((resolve) => observable.subscribe({ complete: () => resolve() }));

    expect(auditService.log).not.toHaveBeenCalled();
  });

  it('does not log a write action (POST) as an access, even if it carries @AuditResource', async () => {
    const request = { method: 'POST', params: { id: 'pay-001' }, user: { sub: 'operator-1' }, ip: '127.0.0.1', headers: {} };
    const interceptor = new FinancialAccessAuditInterceptor({} as any, auditService as any);
    const { context, reflector } = mockContext(request, 'payout_obligation');
    (interceptor as any).reflector = reflector;

    const observable = interceptor.intercept(context, callHandler());
    await new Promise<void>((resolve) => observable.subscribe({ complete: () => resolve() }));

    expect(auditService.log).not.toHaveBeenCalled();
  });

  it('attributes the access to the aurora_operator user id when present on the request', async () => {
    const request = {
      method: 'GET',
      params: { id: 'pay-001' },
      user: { sub: 'jwt-sub-unused' },
      auroraOperatorUserId: 'operator-1',
      ip: '127.0.0.1',
      headers: {},
    };
    const interceptor = new FinancialAccessAuditInterceptor({} as any, auditService as any);
    const { context, reflector } = mockContext(request, 'payout_obligation');
    (interceptor as any).reflector = reflector;

    const observable = interceptor.intercept(context, callHandler());
    await new Promise<void>((resolve) => observable.subscribe({ complete: () => resolve() }));

    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: 'operator-1' }),
    );
  });

  it('never throws or blocks the response when the audit write itself fails', async () => {
    auditService.log.mockRejectedValue(new Error('audit db down'));
    const request = { method: 'GET', params: { id: 'pay-001' }, user: { sub: 'user-1' }, ip: '127.0.0.1', headers: {} };
    const interceptor = new FinancialAccessAuditInterceptor({} as any, auditService as any);
    const { context, reflector } = mockContext(request, 'payout_obligation');
    (interceptor as any).reflector = reflector;

    const observable = interceptor.intercept(context, callHandler({ id: 'pay-001' }));
    const emitted: any[] = [];
    await new Promise<void>((resolve) =>
      observable.subscribe({ next: (v) => emitted.push(v), complete: () => resolve() }),
    );

    expect(emitted).toEqual([{ id: 'pay-001' }]);
  });
});
