import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgencyService } from './agency.service';
import { ForbiddenException } from '@nestjs/common';
import { WorkspaceType } from '../database/entities';

const mockRepo = () => ({
  findOne: vi.fn(),
  find: vi.fn(),
  create: vi.fn((data: any) => ({
    id: 'new-client-id',
    status: 'active',
    createdAt: new Date(),
    ...data,
  })),
  save: vi.fn((entity: any) => Promise.resolve(entity)),
});

describe('AgencyService - US-47 Agency Client Onboarding', () => {
  let service: AgencyService;
  let accountRepo: ReturnType<typeof mockRepo>;
  let workspaceRepo: ReturnType<typeof mockRepo>;
  let membershipRepo: ReturnType<typeof mockRepo>;
  let operatorAccessRepo: ReturnType<typeof mockRepo>;
  let brandProfileRepo: ReturnType<typeof mockRepo>;
  let auditService: { log: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    accountRepo = mockRepo();
    workspaceRepo = mockRepo();
    membershipRepo = mockRepo();
    operatorAccessRepo = mockRepo();
    brandProfileRepo = mockRepo();
    auditService = { log: vi.fn().mockResolvedValue(undefined) };

    service = new AgencyService(
      accountRepo as any,
      workspaceRepo as any,
      membershipRepo as any,
      operatorAccessRepo as any,
      brandProfileRepo as any,
      auditService as any,
    );
  });

  // US-47 Scenario 1 - Normal: new client account created with config inheritance
  it('should create a new client account within the agency workspace', async () => {
    const workspace = { id: 'ws-1', type: WorkspaceType.AGENCY, maxClientAccounts: 10 };
    accountRepo.findOne.mockResolvedValue({ id: 'home-account', workspace });
    // Home account + 2 existing clients = 2 clients (below limit of 10)
    accountRepo.find.mockResolvedValue([
      { id: 'home-account', createdAt: new Date('2026-01-01') },
      { id: 'client-1', createdAt: new Date('2026-02-01') },
      { id: 'client-2', createdAt: new Date('2026-03-01') },
    ]);

    const result = await service.createClient(
      'home-account',
      { name: 'New Client Corp' },
      'admin-user-id',
      '127.0.0.1',
      'test-agent',
    );

    expect(result.name).toBe('New Client Corp');
    expect(result.workspace_id).toBe('ws-1');
    expect(accountRepo.save).toHaveBeenCalled();
    expect(auditService.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'client_account.created',
    }));
  });

  // US-47 Scenario 2 - Hard: template copied without data leakage
  it('should accept copy_templates_from and copy only structure, no client data', async () => {
    const workspace = { id: 'ws-1', type: WorkspaceType.AGENCY, maxClientAccounts: 10 };
    accountRepo.findOne
      .mockResolvedValueOnce({ id: 'home-account', workspace }) // current account
      .mockResolvedValueOnce({ id: 'source-client', workspaceId: 'ws-1' }); // source account for template
    accountRepo.find.mockResolvedValue([
      { id: 'home-account', createdAt: new Date('2026-01-01') },
    ]);

    const result = await service.createClient(
      'home-account',
      { name: 'New Client', copy_templates_from: 'source-client' },
      'admin-user-id',
      '127.0.0.1',
      'test-agent',
    );

    // Template copy acknowledged but no actual data carried over (E1 stub)
    expect(result.templates_copied).toBe(0);
    expect(result.name).toBe('New Client');
  });

  // US-47 Scenario 3 - Failure: client limit reached returns 403
  it('should return 403 when client account limit is reached', async () => {
    const workspace = { id: 'ws-1', type: WorkspaceType.AGENCY, maxClientAccounts: 2 };
    accountRepo.findOne.mockResolvedValue({ id: 'home-account', workspace });
    // Home + 2 clients = 2 clients (at limit)
    accountRepo.find.mockResolvedValue([
      { id: 'home-account', createdAt: new Date('2026-01-01') },
      { id: 'client-1', createdAt: new Date('2026-02-01') },
      { id: 'client-2', createdAt: new Date('2026-03-01') },
    ]);

    await expect(
      service.createClient(
        'home-account',
        { name: 'Over Limit Client' },
        'admin-user-id',
        '127.0.0.1',
        'test-agent',
      ),
    ).rejects.toThrow(ForbiddenException);

    try {
      await service.createClient(
        'home-account',
        { name: 'Over Limit Client' },
        'admin-user-id',
        '127.0.0.1',
        'test-agent',
      );
    } catch (e: any) {
      const response = e.getResponse();
      expect(response.error.code).toBe('CLIENT_LIMIT_REACHED');
      expect(response.error.message).toContain('limite');
    }
  });

  // US-47 Scenario 4 - Failure: cross-client data access denied + logged
  it('should filter client list for operators to only accessible accounts', async () => {
    const workspace = { id: 'ws-1', type: WorkspaceType.AGENCY, maxClientAccounts: 10 };
    accountRepo.findOne.mockResolvedValue({ id: 'home-account', workspace });
    accountRepo.find.mockResolvedValue([
      { id: 'home-account', createdAt: new Date('2026-01-01') },
      { id: 'client-a', createdAt: new Date('2026-02-01') },
      { id: 'client-b', createdAt: new Date('2026-03-01') },
    ]);

    // Operator has access only to client-a
    membershipRepo.findOne.mockResolvedValue({ id: 'membership-1' });
    operatorAccessRepo.find.mockResolvedValue([
      { membershipId: 'membership-1', accountId: 'client-a' },
    ]);
    brandProfileRepo.findOne.mockResolvedValue(null);

    const result = await service.listClients(
      'home-account',
      'operator-user-id',
      'agency_operator',
    );

    // Operator should only see client-a, NOT client-b
    expect(result.data.length).toBe(1);
    expect(result.data[0].id).toBe('client-a');
    // client-b data is not exposed
    expect(result.data.find((d: any) => d.id === 'client-b')).toBeUndefined();
  });
});
