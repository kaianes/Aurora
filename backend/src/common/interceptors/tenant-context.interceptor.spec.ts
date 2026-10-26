import { describe, it, expect, vi, beforeEach } from 'vitest';
import { of, lastValueFrom } from 'rxjs';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { TenantContextInterceptor } from './tenant-context.interceptor';

const mockTenantContextRunner = () => ({
  runAsAccount: vi.fn((accountId: string, work: () => Promise<any>) => work()),
  runAsCreatorPortal: vi.fn((work: () => Promise<any>) => work()),
});

const mockContext = (request: any): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => request }),
  }) as unknown as ExecutionContext;

const mockCallHandler = (value: any = 'handler-result'): CallHandler => ({
  handle: vi.fn(() => of(value)),
});

describe('TenantContextInterceptor', () => {
  let tenantContextRunner: ReturnType<typeof mockTenantContextRunner>;
  let interceptor: TenantContextInterceptor;

  beforeEach(() => {
    tenantContextRunner = mockTenantContextRunner();
    interceptor = new TenantContextInterceptor(tenantContextRunner as any);
  });

  it('calls runAsCreatorPortal, not runAsAccount, when user.isCreator is true', async () => {
    const request = { user: { isCreator: true, sub: 'creator-user-1' }, currentAccountId: undefined };
    const next = mockCallHandler('creator-response');

    const result = await lastValueFrom(interceptor.intercept(mockContext(request), next));

    expect(result).toBe('creator-response');
    expect(tenantContextRunner.runAsCreatorPortal).toHaveBeenCalledTimes(1);
    expect(tenantContextRunner.runAsAccount).not.toHaveBeenCalled();
  });

  it('calls runAsAccount with exactly request.currentAccountId, not a value re-read from headers or user.currentAccountId, when isCreator is falsy', async () => {
    const request = {
      user: { sub: 'brand-user-1', currentAccountId: 'account-from-jwt-claim' },
      currentAccountId: 'account-resolved-by-roles-guard',
      headers: { 'x-account-id': 'account-from-header' },
    };
    const next = mockCallHandler('brand-response');

    const result = await lastValueFrom(interceptor.intercept(mockContext(request), next));

    expect(result).toBe('brand-response');
    expect(tenantContextRunner.runAsAccount).toHaveBeenCalledTimes(1);
    expect(tenantContextRunner.runAsAccount.mock.calls[0][0]).toBe('account-resolved-by-roles-guard');
    expect(tenantContextRunner.runAsCreatorPortal).not.toHaveBeenCalled();
  });

  it('calls neither runAsAccount nor runAsCreatorPortal, and still calls next.handle(), when neither a creator flag nor an accountId resolves', async () => {
    const request = { user: undefined, currentAccountId: undefined };
    const next = mockCallHandler('public-response');

    const result = await lastValueFrom(interceptor.intercept(mockContext(request), next));

    expect(result).toBe('public-response');
    expect(tenantContextRunner.runAsAccount).not.toHaveBeenCalled();
    expect(tenantContextRunner.runAsCreatorPortal).not.toHaveBeenCalled();
    expect(next.handle).toHaveBeenCalledTimes(1);
  });
});
