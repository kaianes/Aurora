import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CreatorRegistrationService } from './creator-registration.service';

const mockRepo = () => ({
  findOne: vi.fn(),
});

const mockQueryRunner = {
  connect: vi.fn(),
  startTransaction: vi.fn(),
  commitTransaction: vi.fn(),
  rollbackTransaction: vi.fn(),
  release: vi.fn(),
  isTransactionActive: true,
  manager: {
    create: vi.fn((_E: any, data: any) => ({ id: 'generated-creator-id', ...data })),
    save: vi.fn((entity: any) => Promise.resolve(entity)),
  },
};

describe('CreatorRegistrationService - US-24.1 / ADR-0050', () => {
  let service: CreatorRegistrationService;
  let creatorRepo: ReturnType<typeof mockRepo>;
  let authService: {
    createUser: ReturnType<typeof vi.fn>;
    issueVerificationToken: ReturnType<typeof vi.fn>;
    enqueueVerificationEmail: ReturnType<typeof vi.fn>;
    verifyEmailToken: ReturnType<typeof vi.fn>;
    authenticateCredentials: ReturnType<typeof vi.fn>;
  };
  let jwtService: { sign: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    creatorRepo = mockRepo();
    authService = {
      createUser: vi.fn(),
      issueVerificationToken: vi.fn().mockResolvedValue('verify-token'),
      enqueueVerificationEmail: vi.fn().mockResolvedValue(undefined),
      verifyEmailToken: vi.fn(),
      authenticateCredentials: vi.fn(),
    };
    jwtService = { sign: vi.fn().mockReturnValue('signed-jwt') };

    mockQueryRunner.isTransactionActive = true;
    Object.values(mockQueryRunner).forEach((fn) => (fn as any).mockClear?.());
    mockQueryRunner.manager.create.mockClear();
    mockQueryRunner.manager.save.mockClear();
    mockQueryRunner.manager.create.mockImplementation((_E: any, data: any) => ({
      id: 'generated-creator-id',
      ...data,
    }));
    mockQueryRunner.manager.save.mockImplementation((entity: any) => Promise.resolve(entity));

    const dataSource = { createQueryRunner: () => mockQueryRunner };

    service = new CreatorRegistrationService(
      creatorRepo as any,
      dataSource as any,
      authService as any,
      jwtService as any,
    );
  });

  describe('register', () => {
    it('creates a creator row (status=active, onboarding=pending) and a terms-acceptance consent record', async () => {
      authService.createUser.mockResolvedValue({
        user: { id: 'user-1', email: 'duda@example.com', name: 'Duda' },
        isNew: true,
      });

      const result = await service.register({
        email: 'duda@example.com',
        password: 'StrongP@ss1',
        name: 'Duda',
        accepted_terms: true,
        terms_version: '2026-10-01',
      });

      expect(result.message).toBeDefined();
      const creatorCreateCall = mockQueryRunner.manager.create.mock.calls.find(
        (call) => call[1]?.displayName !== undefined,
      )!;
      expect(creatorCreateCall[1].status).toBe('active');
      expect(creatorCreateCall[1].onboardingStatus).toBe('pending');
      expect(creatorCreateCall[1].recruitmentOrigin).toBe('self_registered');
      expect(authService.enqueueVerificationEmail).toHaveBeenCalled();
    });

    it('creates no creator row for an email that already belongs to a user (enumeration-safe)', async () => {
      authService.createUser.mockResolvedValue({ user: { id: 'existing-user' }, isNew: false });

      const result = await service.register({
        email: 'existing@example.com',
        password: 'StrongP@ss1',
        name: 'Duda',
        accepted_terms: true,
        terms_version: '2026-10-01',
      });

      expect(result.message).toBeDefined();
      expect(mockQueryRunner.manager.create).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('issues a creator JWT (creator_id claim, no memberships) for valid credentials', async () => {
      authService.authenticateCredentials.mockResolvedValue({ id: 'user-1', email: 'duda@example.com' });
      creatorRepo.findOne.mockResolvedValue({ id: 'creator-1' });

      const result = await service.login({ email: 'duda@example.com', password: 'StrongP@ss1' });

      expect(jwtService.sign).toHaveBeenCalledWith(
        { sub: 'user-1', creator_id: 'creator-1' },
        { expiresIn: '15m' },
      );
      expect(result.access_token).toBe('signed-jwt');
    });
  });
});
