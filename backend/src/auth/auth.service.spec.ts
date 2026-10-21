import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService } from './auth.service';
import { BadRequestException } from '@nestjs/common';
import { generateSync } from 'otplib';

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

// E8 / ADR-0050: the narrow surface creator-network calls into instead of
// reimplementing password hashing, verification tokens, or credential
// checks a second time.
describe('AuthService - exported methods for creator-network (ADR-0050)', () => {
  let service: AuthService;
  let userRepo: ReturnType<typeof mockRepo>;
  let verificationTokenRepo: ReturnType<typeof mockRepo>;
  let manager: {
    findOne: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    userRepo = mockRepo();
    verificationTokenRepo = mockRepo();
    const dataSource = { createQueryRunner: () => mockQueryRunner };
    const jwtService = { sign: vi.fn(), verify: vi.fn() };
    const configService = { get: vi.fn().mockReturnValue('http://localhost:3000') };
    const auditService = { log: vi.fn().mockResolvedValue(undefined) };
    const emailQueue = { add: vi.fn().mockResolvedValue(undefined) };

    service = new AuthService(
      userRepo as any,
      mockRepo() as any,
      mockRepo() as any,
      mockRepo() as any,
      verificationTokenRepo as any,
      dataSource as any,
      jwtService as any,
      configService as any,
      auditService as any,
      emailQueue as any,
    );

    manager = {
      findOne: vi.fn(),
      create: vi.fn((_Entity: any, data: any) => ({ id: 'generated-user-id', ...data })),
      save: vi.fn((entity: any) => Promise.resolve(entity)),
    };
  });

  it('createUser creates a new user row when the email is unused', async () => {
    manager.findOne.mockResolvedValue(null);

    const result = await service.createUser(manager as any, {
      email: 'duda@example.com',
      password: 'StrongP@ss1',
      name: 'Duda',
    });

    expect(result.isNew).toBe(true);
    expect(result.user.email).toBe('duda@example.com');
    expect(manager.save).toHaveBeenCalled();
  });

  it('createUser returns the existing user and creates nothing when the email is already registered', async () => {
    const existing = { id: 'existing-id', email: 'duda@example.com' };
    manager.findOne.mockResolvedValue(existing);

    const result = await service.createUser(manager as any, {
      email: 'duda@example.com',
      password: 'StrongP@ss1',
      name: 'Duda',
    });

    expect(result.isNew).toBe(false);
    expect(result.user).toBe(existing);
    expect(manager.create).not.toHaveBeenCalled();
  });

  it('authenticateCredentials rejects an unverified account', async () => {
    const bcrypt = await import('bcrypt');
    const passwordHash = await bcrypt.hash('StrongP@ss1', 12);
    userRepo.findOne.mockResolvedValue({
      id: 'user-1',
      email: 'duda@example.com',
      passwordHash,
      emailVerified: false,
    });

    await expect(
      service.authenticateCredentials('duda@example.com', 'StrongP@ss1'),
    ).rejects.toThrow();
  });

  it('authenticateCredentials returns the user for correct, verified credentials', async () => {
    const bcrypt = await import('bcrypt');
    const passwordHash = await bcrypt.hash('StrongP@ss1', 12);
    const user = { id: 'user-1', email: 'duda@example.com', passwordHash, emailVerified: true };
    userRepo.findOne.mockResolvedValue(user);

    const result = await service.authenticateCredentials('duda@example.com', 'StrongP@ss1');

    expect(result).toBe(user);
  });

  // Failure case: a wrong password for an existing, verified account is rejected with the
  // same generic INVALID_CREDENTIALS code as an unknown email -- never a hint about which
  // half (email or password) was wrong.
  it('authenticateCredentials rejects a wrong password for an existing, verified account', async () => {
    const bcrypt = await import('bcrypt');
    const passwordHash = await bcrypt.hash('StrongP@ss1', 12);
    userRepo.findOne.mockResolvedValue({
      id: 'user-1',
      email: 'duda@example.com',
      passwordHash,
      emailVerified: true,
    });

    await expect(
      service.authenticateCredentials('duda@example.com', 'WrongPassword1!'),
    ).rejects.toThrow();
  });

  // Failure case: an email that belongs to no user at all is rejected the same way as a
  // wrong password -- no enumeration signal either way.
  it('authenticateCredentials rejects an email with no matching user', async () => {
    userRepo.findOne.mockResolvedValue(null);

    await expect(
      service.authenticateCredentials('ghost@example.com', 'whatever-password'),
    ).rejects.toThrow();
  });

  // verifyEmailToken is the creator-network path's own exported method (distinct from the
  // brand-facing verifyEmail above, which also issues brand tokens/memberships) -- it needs
  // its own direct coverage of the normal, expired, and already-used cases.
  describe('verifyEmailToken', () => {
    it('verifies a valid, unused token and marks the user as email-verified', async () => {
      verificationTokenRepo.findOne.mockResolvedValue({
        id: 'vt-1',
        userId: 'user-1',
        used: false,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      });
      const user = { id: 'user-1', email: 'duda@example.com', emailVerified: false };
      userRepo.findOne.mockResolvedValue(user);

      const result = await service.verifyEmailToken('valid-token');

      expect(result.emailVerified).toBe(true);
      expect(verificationTokenRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ used: true }),
      );
    });

    it('rejects an unknown or already-used token with INVALID_TOKEN', async () => {
      verificationTokenRepo.findOne.mockResolvedValue({
        id: 'vt-1',
        userId: 'user-1',
        used: true,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      });

      await expect(service.verifyEmailToken('used-token')).rejects.toThrow(BadRequestException);
    });

    it('rejects a genuinely expired token with VERIFICATION_EXPIRED, not a confusing generic error', async () => {
      verificationTokenRepo.findOne.mockResolvedValue({
        id: 'vt-1',
        userId: 'user-1',
        used: false,
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(service.verifyEmailToken('expired-token')).rejects.toMatchObject({
        response: { error: { code: 'VERIFICATION_EXPIRED' } },
      });
    });
  });
});

// Regression: mfaSetup/mfaConfirm called otplib's v10-12 `authenticator`
// export, removed in the installed v13. Nothing mocks otplib here --
// generateSync produces a real TOTP code against the secret mfaSetup
// returns, so this exercises the actual library API, the only way this bug
// would have been caught (it crashed in every environment, not just
// production).
describe('AuthService - MFA setup and confirm', () => {
  let service: AuthService;
  let userRepo: ReturnType<typeof mockRepo>;

  beforeEach(() => {
    userRepo = mockRepo();
    const auditService = { log: vi.fn().mockResolvedValue(undefined) };
    const emailQueue = { add: vi.fn().mockResolvedValue(undefined) };
    const dataSource = { createQueryRunner: () => mockQueryRunner };
    const jwtService = { sign: vi.fn(), verify: vi.fn() };
    const configService = { get: vi.fn().mockReturnValue('http://localhost:3000') };

    service = new AuthService(
      userRepo as any,
      mockRepo() as any,
      mockRepo() as any,
      mockRepo() as any,
      mockRepo() as any,
      dataSource as any,
      jwtService as any,
      configService as any,
      auditService as any,
      emailQueue as any,
    );
  });

  it('generates a secret and QR URL that a real authenticator app could use', async () => {
    const user = { id: 'user-1', email: 'marina@example.com', mfaSecret: null as string | null };
    userRepo.findOne.mockResolvedValue(user);

    const result = await service.mfaSetup('user-1');

    expect(result.secret).toMatch(/^[A-Z2-7]+$/); // base32
    expect(result.qr_code_url).toContain('otpauth://totp/');
    expect(result.qr_code_url).toContain(encodeURIComponent('marina@example.com'));
    expect(result.backup_codes).toHaveLength(8);
    expect(user.mfaSecret).toBe(result.secret);
  });

  it('confirms MFA with a code generated from the real secret and enables it', async () => {
    const user = { id: 'user-1', mfaSecret: null as string | null, mfaEnabled: false };
    userRepo.findOne.mockResolvedValue(user);

    const { secret } = await service.mfaSetup('user-1');
    const validCode = generateSync({ strategy: 'totp', secret });

    await service.mfaConfirm('user-1', validCode, '127.0.0.1', 'vitest');

    expect(user.mfaEnabled).toBe(true);
  });

  it('rejects an incorrect MFA code without enabling MFA', async () => {
    const user = { id: 'user-1', mfaSecret: null as string | null, mfaEnabled: false };
    userRepo.findOne.mockResolvedValue(user);

    await service.mfaSetup('user-1');

    await expect(
      service.mfaConfirm('user-1', '000000', '127.0.0.1', 'vitest'),
    ).rejects.toThrow(BadRequestException);
    expect(user.mfaEnabled).toBe(false);
  });
});
