import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService } from './auth.service';
import { BadRequestException } from '@nestjs/common';

// Helpers to build mock repos
const mockRepo = () => ({
  findOne: vi.fn(),
  find: vi.fn(),
  create: vi.fn((entity: any) => entity),
  save: vi.fn((entity: any) => Promise.resolve({ id: 'generated-id', ...entity })),
  update: vi.fn(),
});

const mockQueryRunner = {
  connect: vi.fn(),
  startTransaction: vi.fn(),
  commitTransaction: vi.fn(),
  rollbackTransaction: vi.fn(),
  release: vi.fn(),
  manager: {
    create: vi.fn((_Entity: any, data: any) => ({ id: 'generated-id', ...data })),
    save: vi.fn((entity: any) => Promise.resolve(entity)),
  },
};

describe('AuthService - US-01 Self-Service Brand Sign-Up', () => {
  let service: AuthService;
  let userRepo: ReturnType<typeof mockRepo>;
  let workspaceRepo: ReturnType<typeof mockRepo>;
  let accountRepo: ReturnType<typeof mockRepo>;
  let membershipRepo: ReturnType<typeof mockRepo>;
  let verificationTokenRepo: ReturnType<typeof mockRepo>;
  let auditService: { log: ReturnType<typeof vi.fn> };
  let emailQueue: { add: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    userRepo = mockRepo();
    workspaceRepo = mockRepo();
    accountRepo = mockRepo();
    membershipRepo = mockRepo();
    verificationTokenRepo = mockRepo();
    auditService = { log: vi.fn().mockResolvedValue(undefined) };
    emailQueue = { add: vi.fn().mockResolvedValue(undefined) };

    const dataSource = { createQueryRunner: () => mockQueryRunner };
    const jwtService = {
      sign: vi.fn().mockReturnValue('mock-token'),
      verify: vi.fn(),
    };
    const configService = { get: vi.fn().mockReturnValue('http://localhost:3000') };

    service = new AuthService(
      userRepo as any,
      workspaceRepo as any,
      accountRepo as any,
      membershipRepo as any,
      verificationTokenRepo as any,
      dataSource as any,
      jwtService as any,
      configService as any,
      auditService as any,
      emailQueue as any,
    );

    // Reset query runner mocks
    Object.values(mockQueryRunner).forEach((fn) => {
      if (typeof fn === 'function') (fn as any).mockClear?.();
    });
    Object.values(mockQueryRunner.manager).forEach((fn) => {
      if (typeof fn === 'function') (fn as any).mockClear?.();
    });
    mockQueryRunner.manager.create.mockImplementation((_E: any, data: any) => ({
      id: 'generated-id',
      ...data,
    }));
    mockQueryRunner.manager.save.mockImplementation((entity: any) =>
      Promise.resolve(entity),
    );
  });

  // US-01 Scenario 1 - Normal: successful registration
  it('should create workspace, account, and membership on successful registration', async () => {
    userRepo.findOne.mockResolvedValue(null); // no existing user

    const result = await service.register(
      {
        email: 'marina@brand.com',
        password: 'StrongP@ss1',
        name: 'Marina',
        workspace_name: 'My Brand',
        workspace_type: 'brand',
      },
      '127.0.0.1',
      'test-agent',
    );

    // Should create user, workspace, account, membership, verification token (5 entities)
    expect(mockQueryRunner.manager.create).toHaveBeenCalledTimes(5);
    expect(mockQueryRunner.manager.save).toHaveBeenCalledTimes(5);
    expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();

    // Should send verification email
    expect(emailQueue.add).toHaveBeenCalledWith('send-email', expect.objectContaining({
      template: 'email_verification',
      to: 'marina@brand.com',
    }));

    // Should return success message
    expect(result.message).toBeDefined();
    expect(result.user_id).toBeDefined();
  });

  // US-01 Scenario 2 - Hard: duplicate email returns generic message (no enumeration)
  it('should return same message for duplicate email to prevent enumeration', async () => {
    userRepo.findOne.mockResolvedValue({ id: 'existing-user-id', email: 'marina@brand.com' });

    const result = await service.register(
      {
        email: 'marina@brand.com',
        password: 'StrongP@ss1',
        name: 'Marina',
        workspace_name: 'My Brand',
        workspace_type: 'brand',
      },
      '127.0.0.1',
      'test-agent',
    );

    // Should NOT create any new entities
    expect(mockQueryRunner.manager.create).not.toHaveBeenCalled();

    // Should return the same message as a successful registration
    expect(result.message).toContain('Verifique seu email');
    // Should NOT throw an error or reveal that the email exists
    expect(result.user_id).toBeDefined();
  });

  // US-01 Scenario 3 - Failure: expired verification link
  it('should return VERIFICATION_EXPIRED with resend URL when token is expired', async () => {
    const expiredDate = new Date(Date.now() - 1000); // expired 1 second ago
    verificationTokenRepo.findOne.mockResolvedValue({
      token: 'expired-token',
      purpose: 'email_verification',
      used: false,
      expiresAt: expiredDate,
      userId: 'user-1',
    });

    await expect(
      service.verifyEmail('expired-token', '127.0.0.1', 'test-agent'),
    ).rejects.toThrow(BadRequestException);

    try {
      await service.verifyEmail('expired-token', '127.0.0.1', 'test-agent');
    } catch (e: any) {
      const response = e.getResponse();
      expect(response.error.code).toBe('VERIFICATION_EXPIRED');
      expect(response.error.details.resend_url).toBeDefined();
    }
  });
});
