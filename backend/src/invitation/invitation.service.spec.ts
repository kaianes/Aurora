import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InvitationService } from './invitation.service';
import { ConflictException } from '@nestjs/common';
import { InvitationStatus } from '../database/entities';

const mockRepo = () => ({
  findOne: vi.fn(),
  find: vi.fn(),
  create: vi.fn((data: any) => ({
    id: 'inv-id',
    createdAt: new Date(),
    ...data,
  })),
  save: vi.fn((entity: any) => Promise.resolve(entity)),
  createQueryBuilder: vi.fn(),
});

describe('InvitationService - US-04 Team Invitation', () => {
  let service: InvitationService;
  let invitationRepo: ReturnType<typeof mockRepo>;
  let userRepo: ReturnType<typeof mockRepo>;
  let membershipRepo: ReturnType<typeof mockRepo>;
  let accountRepo: ReturnType<typeof mockRepo>;
  let auditService: { log: ReturnType<typeof vi.fn> };
  let emailQueue: { add: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    invitationRepo = mockRepo();
    userRepo = mockRepo();
    membershipRepo = mockRepo();
    accountRepo = mockRepo();
    auditService = { log: vi.fn().mockResolvedValue(undefined) };
    emailQueue = { add: vi.fn().mockResolvedValue(undefined) };
    const configService = { get: vi.fn().mockReturnValue('http://localhost:3000') };
    const dataSource = { createQueryRunner: vi.fn() };

    service = new InvitationService(
      invitationRepo as any,
      userRepo as any,
      membershipRepo as any,
      accountRepo as any,
      dataSource as any,
      auditService as any,
      configService as any,
      emailQueue as any,
    );
  });

  // US-04 Scenario 1 - Normal: invitation sent successfully by owner
  it('should create invitation and send email when owner invites', async () => {
    invitationRepo.findOne.mockResolvedValue(null); // no pending invitation
    accountRepo.findOne.mockResolvedValue({ id: 'account-1', name: 'Brand Co', workspace: { id: 'ws-1' } });

    const result = await service.create(
      'account-1',
      'brand',
      { email: 'colleague@example.com', role: 'brand_manager' },
      'owner-user-id',
      '127.0.0.1',
      'test-agent',
    );

    expect(result.id).toBeDefined();
    expect(result.email).toBe('colleague@example.com');
    expect(result.role).toBe('brand_manager');
    expect(result.status).toBe(InvitationStatus.PENDING);

    // Email sent
    expect(emailQueue.add).toHaveBeenCalledWith('send-email', expect.objectContaining({
      template: 'invitation',
      to: 'colleague@example.com',
    }));

    // Audit logged
    expect(auditService.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'invitation.created',
    }));
  });

  // US-04 Scenario 2 - Hard: existing user accepts invitation and gets new membership
  it('should add membership to existing user when they accept invitation', async () => {
    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    invitationRepo.findOne.mockResolvedValue({
      id: 'inv-1',
      accountId: 'account-1',
      email: 'existing@example.com',
      role: 'brand_manager',
      token: 'valid-token',
      status: InvitationStatus.PENDING,
      expiresAt: futureDate,
      account: { name: 'Brand Co', workspaceId: 'ws-1' },
    });

    userRepo.findOne.mockResolvedValue({
      id: 'existing-user-id',
      email: 'existing@example.com',
      name: 'Existing User',
    });

    membershipRepo.create.mockReturnValue({
      userId: 'existing-user-id',
      accountId: 'account-1',
      role: 'brand_manager',
    });
    membershipRepo.save.mockResolvedValue({
      userId: 'existing-user-id',
      accountId: 'account-1',
      role: 'brand_manager',
    });
    invitationRepo.save.mockResolvedValue({});

    const result = await service.accept(
      { token: 'valid-token' },
      'existing-user-id', // authenticated user
      '127.0.0.1',
      'test-agent',
    );

    expect(result.account_id).toBe('account-1');
    expect(result.role).toBe('brand_manager');
    expect(membershipRepo.save).toHaveBeenCalled();
  });

  // US-04 Scenario 3 - Failure: duplicate pending invitation returns 409
  it('should return 409 when a pending invitation already exists for the email', async () => {
    invitationRepo.findOne.mockResolvedValue({
      id: 'existing-inv',
      accountId: 'account-1',
      email: 'colleague@example.com',
      status: InvitationStatus.PENDING,
    });

    await expect(
      service.create(
        'account-1',
        'brand',
        { email: 'colleague@example.com', role: 'brand_manager' },
        'owner-user-id',
        '127.0.0.1',
        'test-agent',
      ),
    ).rejects.toThrow(ConflictException);

    try {
      await service.create(
        'account-1',
        'brand',
        { email: 'colleague@example.com', role: 'brand_manager' },
        'owner-user-id',
        '127.0.0.1',
        'test-agent',
      );
    } catch (e: any) {
      expect(e.getResponse().error.code).toBe('INVITATION_PENDING');
    }
  });
});

describe('RolesGuard - US-04 Scenario 4: Insufficient privileges', () => {
  it('should deny analyst role from creating invitations and log the attempt', async () => {
    // Import the guard to test it directly
    const { RolesGuard } = await import('../common/guards/roles.guard');
    const { Role } = await import('../database/entities');

    const auditService = { log: vi.fn().mockResolvedValue(undefined) };
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue([Role.BRAND_OWNER, Role.AGENCY_ADMIN]),
    };

    const accountAccessService = {
      resolveAccess: vi.fn().mockResolvedValue(Role.BRAND_ANALYST),
    };

    const guard = new RolesGuard(reflector as any, auditService as any, accountAccessService as any);

    const mockRequest = {
      user: {
        sub: 'analyst-user-id',
        memberships: [
          { account_id: 'account-1', role: Role.BRAND_ANALYST },
        ],
      },
      headers: { 'x-account-id': 'account-1', 'user-agent': 'test' },
      ip: '127.0.0.1',
      url: '/invitations',
      method: 'POST',
    };

    const context = {
      switchToHttp: () => ({ getRequest: () => mockRequest }),
      getHandler: () => ({}),
      getClass: () => ({}),
    };

    const { ForbiddenException } = await import('@nestjs/common');

    await expect(guard.canActivate(context as any)).rejects.toThrow(ForbiddenException);

    // Audit log should record the denied attempt
    expect(auditService.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'authorization.denied',
      actorUserId: 'analyst-user-id',
      metadata: expect.objectContaining({
        user_role: Role.BRAND_ANALYST,
      }),
    }));
  });
});
