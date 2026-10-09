import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AccountAccessService } from './account-access.service';
import { Role } from '../database/entities';

const mockRepo = () => ({ findOne: vi.fn() });

describe('AccountAccessService', () => {
  let accountRepo: ReturnType<typeof mockRepo>;
  let membershipRepo: ReturnType<typeof mockRepo>;
  let operatorAccessRepo: ReturnType<typeof mockRepo>;
  let service: AccountAccessService;

  beforeEach(() => {
    accountRepo = mockRepo();
    membershipRepo = mockRepo();
    operatorAccessRepo = mockRepo();
    service = new AccountAccessService(
      accountRepo as any,
      membershipRepo as any,
      operatorAccessRepo as any,
    );
  });

  it('resolves a direct membership without any DB lookup', async () => {
    const role = await service.resolveAccess(
      'user-1',
      [{ account_id: 'account-1', role: Role.BRAND_OWNER }],
      'account-1',
    );

    expect(role).toBe(Role.BRAND_OWNER);
    expect(accountRepo.findOne).not.toHaveBeenCalled();
  });

  it('returns null with no accountId, so creator-portal requests are never DB-checked', async () => {
    const role = await service.resolveAccess('user-1', [], undefined);
    expect(role).toBeNull();
    expect(accountRepo.findOne).not.toHaveBeenCalled();
  });

  it('grants an agency_admin implicit access to any client account in their own workspace', async () => {
    accountRepo.findOne.mockImplementation(({ where: { id } }: any) =>
      Promise.resolve(
        id === 'client-account'
          ? { id: 'client-account', workspaceId: 'ws-1' }
          : { id: 'agency-home', workspaceId: 'ws-1' },
      ),
    );

    const role = await service.resolveAccess(
      'user-1',
      [{ account_id: 'agency-home', role: Role.AGENCY_ADMIN }],
      'client-account',
    );

    expect(role).toBe(Role.AGENCY_ADMIN);
  });

  it('grants an agency_operator access to a client account with a matching operator_client_access grant', async () => {
    accountRepo.findOne.mockImplementation(({ where: { id } }: any) =>
      Promise.resolve(
        id === 'client-account'
          ? { id: 'client-account', workspaceId: 'ws-1' }
          : { id: 'agency-home', workspaceId: 'ws-1' },
      ),
    );
    membershipRepo.findOne.mockResolvedValue({ id: 'membership-1' });
    operatorAccessRepo.findOne.mockResolvedValue({ id: 'grant-1' });

    const role = await service.resolveAccess(
      'user-1',
      [{ account_id: 'agency-home', role: Role.AGENCY_OPERATOR }],
      'client-account',
    );

    expect(role).toBe(Role.AGENCY_OPERATOR);
  });

  // Regression: this used to be checked (and buggy) inside
  // ShortlistService.overrideShortlist directly; it now lives here, enforced
  // by RolesGuard before any handler runs (NFR-16).
  it('denies an agency_operator with no operator_client_access grant for that client account', async () => {
    accountRepo.findOne.mockImplementation(({ where: { id } }: any) =>
      Promise.resolve(
        id === 'client-account'
          ? { id: 'client-account', workspaceId: 'ws-1' }
          : { id: 'agency-home', workspaceId: 'ws-1' },
      ),
    );
    membershipRepo.findOne.mockResolvedValue({ id: 'membership-1' });
    operatorAccessRepo.findOne.mockResolvedValue(null);

    const role = await service.resolveAccess(
      'user-1',
      [{ account_id: 'agency-home', role: Role.AGENCY_OPERATOR }],
      'client-account',
    );

    expect(role).toBeNull();
  });

  it('denies any user with no relationship at all to the target account', async () => {
    accountRepo.findOne.mockResolvedValue({ id: 'someone-elses-account', workspaceId: 'ws-9' });

    const role = await service.resolveAccess(
      'user-1',
      [{ account_id: 'own-account', role: Role.BRAND_OWNER }],
      'someone-elses-account',
    );

    expect(role).toBeNull();
  });

  it('denies access across two different agency workspaces', async () => {
    accountRepo.findOne.mockImplementation(({ where: { id } }: any) =>
      Promise.resolve(
        id === 'other-agencys-client'
          ? { id: 'other-agencys-client', workspaceId: 'ws-other' }
          : { id: 'agency-home', workspaceId: 'ws-mine' },
      ),
    );

    const role = await service.resolveAccess(
      'user-1',
      [{ account_id: 'agency-home', role: Role.AGENCY_ADMIN }],
      'other-agencys-client',
    );

    expect(role).toBeNull();
  });
});
