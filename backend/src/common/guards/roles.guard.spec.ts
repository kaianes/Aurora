import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { RolesGuard } from './roles.guard';
import { Role } from '../../database/entities';

const mockReflector = () => ({ getAllAndOverride: vi.fn() });
const mockAuditService = () => ({ log: vi.fn() });
const mockAccountAccessService = () => ({ resolveAccess: vi.fn() });

// Builds a minimal ExecutionContext-shaped object. request is whatever the
// test wants switchToHttp().getRequest() to return; getHandler/getClass are
// only ever used as opaque keys passed through to Reflector in this guard,
// never inspected by it, so fixed stand-ins are enough for these tests.
const mockContext = (request: any): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  }) as unknown as ExecutionContext;

describe('RolesGuard', () => {
  let reflector: ReturnType<typeof mockReflector>;
  let auditService: ReturnType<typeof mockAuditService>;
  let accountAccessService: ReturnType<typeof mockAccountAccessService>;
  let guard: RolesGuard;

  beforeEach(() => {
    reflector = mockReflector();
    auditService = mockAuditService();
    accountAccessService = mockAccountAccessService();
    guard = new RolesGuard(reflector as any, auditService as any, accountAccessService as any);
  });

  // isPublic / isCreatorPortalRoute / requiredRoles, in that call order.
  const metadata = (isPublic: boolean, isCreatorPortalRoute: boolean, requiredRoles?: Role[]) => {
    reflector.getAllAndOverride
      .mockReturnValueOnce(isPublic)
      .mockReturnValueOnce(isCreatorPortalRoute)
      .mockReturnValueOnce(requiredRoles);
  };

  it('returns true for a @Public() route with no user, and does not audit-log', async () => {
    metadata(true, false);
    const request = { headers: {}, user: undefined };

    const result = await guard.canActivate(mockContext(request));

    expect(result).toBe(true);
    expect(auditService.log).not.toHaveBeenCalled();
    expect(accountAccessService.resolveAccess).not.toHaveBeenCalled();
  });

  it('returns true for a @CreatorPortalRoute() with no accountId resolvable, without auditing or resolving access', async () => {
    metadata(false, true);
    const request = {
      headers: {},
      user: { sub: 'creator-user-1', isCreator: true },
    };

    const result = await guard.canActivate(mockContext(request));

    expect(result).toBe(true);
    expect(auditService.log).not.toHaveBeenCalled();
    expect(accountAccessService.resolveAccess).not.toHaveBeenCalled();
  });

  it('throws and logs reason=no_account_context for an undecorated route hit by a creator JWT with no X-Account-Id', async () => {
    metadata(false, false);
    const request = {
      headers: {},
      url: '/v1/campaigns',
      method: 'GET',
      ip: '10.0.0.1',
      user: { sub: 'creator-user-1', isCreator: true },
    };

    await expect(guard.canActivate(mockContext(request))).rejects.toThrow(ForbiddenException);

    expect(auditService.log).toHaveBeenCalledTimes(1);
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'creator-user-1',
        targetAccountId: null,
        action: 'authorization.denied',
        metadata: expect.objectContaining({ reason: 'no_account_context' }),
      }),
    );
    expect(accountAccessService.resolveAccess).not.toHaveBeenCalled();
  });

  it('throws and logs reason=no_account_context for an undecorated route hit by a non-creator user with no X-Account-Id', async () => {
    metadata(false, false);
    const request = {
      headers: {},
      url: '/v1/campaigns',
      method: 'GET',
      ip: '10.0.0.2',
      user: { sub: 'brand-user-1', memberships: [] },
    };

    await expect(guard.canActivate(mockContext(request))).rejects.toThrow(ForbiddenException);

    expect(auditService.log).toHaveBeenCalledTimes(1);
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'brand-user-1',
        action: 'authorization.denied',
        metadata: expect.objectContaining({ reason: 'no_account_context' }),
      }),
    );
    expect(accountAccessService.resolveAccess).not.toHaveBeenCalled();
  });

  it('throws and logs reason=no_account_relationship when accountId resolves but resolveAccess returns falsy (regression guard)', async () => {
    metadata(false, false);
    accountAccessService.resolveAccess.mockResolvedValue(null);
    const request = {
      headers: { 'x-account-id': 'account-1' },
      url: '/v1/campaigns',
      method: 'GET',
      ip: '10.0.0.3',
      user: { sub: 'brand-user-1', memberships: [] },
    };

    await expect(guard.canActivate(mockContext(request))).rejects.toThrow(ForbiddenException);

    expect(accountAccessService.resolveAccess).toHaveBeenCalledWith(
      'brand-user-1',
      [],
      'account-1',
    );
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        targetAccountId: 'account-1',
        metadata: expect.objectContaining({ reason: 'no_account_relationship' }),
      }),
    );
  });

  it('returns true and sets currentAccountId/currentRole when access resolves and no roles are required', async () => {
    metadata(false, false, undefined);
    accountAccessService.resolveAccess.mockResolvedValue(Role.BRAND_OWNER);
    const request = {
      headers: { 'x-account-id': 'account-1' },
      user: { sub: 'brand-user-1', memberships: [] },
    };

    const result = await guard.canActivate(mockContext(request));

    expect(result).toBe(true);
    expect(request.currentAccountId).toBe('account-1');
    expect(request.currentRole).toBe(Role.BRAND_OWNER);
    expect(auditService.log).not.toHaveBeenCalled();
  });

  it('throws when the resolved role is not in the required roles list', async () => {
    metadata(false, false, [Role.AGENCY_ADMIN]);
    accountAccessService.resolveAccess.mockResolvedValue(Role.BRAND_OWNER);
    const request = {
      headers: { 'x-account-id': 'account-1' },
      url: '/v1/campaigns',
      method: 'POST',
      ip: '10.0.0.4',
      user: { sub: 'brand-user-1', memberships: [] },
    };

    await expect(guard.canActivate(mockContext(request))).rejects.toThrow(ForbiddenException);
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          required_roles: [Role.AGENCY_ADMIN],
          user_role: Role.BRAND_OWNER,
        }),
      }),
    );
  });
});
