import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { OperatorAuthGuard } from './operator-auth.guard';

const mockRepo = () => ({ findOne: vi.fn() });

function mockContext(user: any) {
  const request: any = { user };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as any;
}

describe('OperatorAuthGuard - ADR-0038', () => {
  let guard: OperatorAuthGuard;
  let userRepo: ReturnType<typeof mockRepo>;

  beforeEach(() => {
    userRepo = mockRepo();
    guard = new OperatorAuthGuard(userRepo as any);
  });

  it('rejects a request with no authenticated user', async () => {
    await expect(guard.canActivate(mockContext(undefined))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a user who is not flagged is_aurora_operator (OPERATOR_AUTH_REQUIRED)', async () => {
    userRepo.findOne.mockResolvedValue({ id: 'user-1', isAuroraOperator: false, mfaEnabled: true });
    await expect(guard.canActivate(mockContext({ sub: 'user-1' }))).rejects.toMatchObject({
      response: { error: { code: 'OPERATOR_AUTH_REQUIRED' } },
    });
  });

  it('rejects an operator without MFA enabled (MFA_REQUIRED_FOR_ROLE, NFR-19)', async () => {
    userRepo.findOne.mockResolvedValue({ id: 'user-1', isAuroraOperator: true, mfaEnabled: false });
    await expect(guard.canActivate(mockContext({ sub: 'user-1' }))).rejects.toMatchObject({
      response: { error: { code: 'MFA_REQUIRED_FOR_ROLE' } },
    });
  });

  it('allows an MFA-verified operator through and records the operator id on the request', async () => {
    userRepo.findOne.mockResolvedValue({ id: 'user-1', isAuroraOperator: true, mfaEnabled: true });
    const request: any = { user: { sub: 'user-1' } };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as any;

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(request.auroraOperatorUserId).toBe('user-1');
  });
});
