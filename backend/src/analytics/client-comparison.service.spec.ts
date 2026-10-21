import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { ClientComparisonService } from './client-comparison.service';
import { Role } from '../database/entities';

const mockRepo = () => ({
  findOne: vi.fn(),
  find: vi.fn().mockResolvedValue([]),
});

function mockQueryRunner() {
  const manager = {
    findOne: vi.fn().mockResolvedValue(undefined),
  };
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    startTransaction: vi.fn().mockResolvedValue(undefined),
    commitTransaction: vi.fn().mockResolvedValue(undefined),
    rollbackTransaction: vi.fn().mockResolvedValue(undefined),
    release: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue(undefined),
    manager,
  };
}

describe('ClientComparisonService - US-46', () => {
  let service: ClientComparisonService;
  let accountRepo: ReturnType<typeof mockRepo>;
  let membershipRepo: ReturnType<typeof mockRepo>;
  let operatorAccessRepo: ReturnType<typeof mockRepo>;
  let campaignRepo: ReturnType<typeof mockRepo>;
  let invoiceRepo: ReturnType<typeof mockRepo>;
  let dataSource: { createQueryRunner: ReturnType<typeof vi.fn> };
  let queryRunner: ReturnType<typeof mockQueryRunner>;

  beforeEach(() => {
    accountRepo = mockRepo();
    membershipRepo = mockRepo();
    operatorAccessRepo = mockRepo();
    campaignRepo = mockRepo();
    invoiceRepo = mockRepo();
    queryRunner = mockQueryRunner();
    dataSource = { createQueryRunner: vi.fn(() => queryRunner) };

    service = new ClientComparisonService(
      accountRepo as any,
      membershipRepo as any,
      operatorAccessRepo as any,
      campaignRepo as any,
      invoiceRepo as any,
      dataSource as any,
    );

    accountRepo.findOne.mockImplementation(({ where }: any) => {
      if (where.id === 'home-1') return Promise.resolve({ id: 'home-1', workspaceId: 'ws-1' });
      if (where.id === 'acct-1') return Promise.resolve({ id: 'acct-1', workspaceId: 'ws-1', name: 'Loja A' });
      if (where.id === 'acct-2') return Promise.resolve({ id: 'acct-2', workspaceId: 'ws-1', name: 'Loja B' });
      if (where.id === 'acct-other-workspace')
        return Promise.resolve({ id: 'acct-other-workspace', workspaceId: 'ws-2', name: 'Loja C' });
      return Promise.resolve(undefined);
    });
  });

  // ---- US-46 scenario 1/2: a side-by-side comparison, honest totals and
  // per-campaign averages, no false equivalence ----
  it('returns totals and per-campaign averages for each accessible client, agency_admin', async () => {
    invoiceRepo.findOne.mockResolvedValue(undefined);
    queryRunner.manager.findOne.mockResolvedValue({
      totalDeliveredReach: '100000',
      totalDeliveredEngagement: '4000',
    });
    // campaign.lockedPrice is read via campaignRepo.find results directly
    campaignRepo.find.mockImplementation(({ where }: any) => {
      if (where.accountId === 'acct-1') {
        return Promise.resolve([
          { id: 'camp-1', lockedPrice: '100000.00' },
          { id: 'camp-2', lockedPrice: '80000.00' },
        ]);
      }
      return Promise.resolve([{ id: 'camp-3', lockedPrice: '20000.00' }]);
    });

    const result = await service.compareClients('home-1', 'user-1', Role.AGENCY_ADMIN, [
      'acct-1',
      'acct-2',
    ]);

    expect(result.refused).toEqual([]);
    expect(result.data).toHaveLength(2);
    const clientA = result.data.find((d: any) => d.client_account_id === 'acct-1');
    expect(clientA).toBeDefined();
    expect(clientA!.campaign_count).toBe(2);
    // Each of acct-1's 2 campaigns contributes the same mocked aggregate
    // (100000 reach) -> total 200000, average 100000/campaign.
    expect(clientA!.total_delivered_reach).toBe(200000);
    expect(clientA!.average_reach_per_campaign).toBe(100000);
  });

  // ---- US-46 / ADR-0048, section 5.6: the RLS escape hatch that lets
  // campaign_performance_aggregate rows for a client other than the
  // caller's own be read at all must actually be set on the connection,
  // before those aggregate reads run -- not just that the final totals
  // come out correct, since nothing in this suite's mocks would catch a
  // missing SET LOCAL (RLS is not enforced by a mock repository). ----
  it('sets the agency_cross_client_read and current_workspace_id session flags before reading aggregates', async () => {
    campaignRepo.find.mockResolvedValue([{ id: 'camp-1', lockedPrice: '10000.00' }]);
    invoiceRepo.findOne.mockResolvedValue(undefined);
    queryRunner.manager.findOne.mockResolvedValue(undefined);

    await service.compareClients('home-1', 'user-1', Role.AGENCY_ADMIN, ['acct-1']);

    expect(dataSource.createQueryRunner).toHaveBeenCalled();
    expect(queryRunner.connect).toHaveBeenCalled();
    expect(queryRunner.startTransaction).toHaveBeenCalled();

    const calls = queryRunner.query.mock.calls;
    const crossClientFlagCallIndex = calls.findIndex(
      (call) => typeof call[0] === 'string' && call[0].includes('app.agency_cross_client_read'),
    );
    const workspaceFlagCallIndex = calls.findIndex(
      (call) => typeof call[0] === 'string' && call[0].includes('app.current_workspace_id'),
    );

    expect(crossClientFlagCallIndex).toBeGreaterThanOrEqual(0);
    expect(calls[crossClientFlagCallIndex][0]).toContain("'true'");

    expect(workspaceFlagCallIndex).toBeGreaterThanOrEqual(0);
    expect(calls[workspaceFlagCallIndex][1]).toEqual(['ws-1']);

    // Both flags must be set before the aggregate read for this client's
    // one campaign, not after.
    const aggregateReadOrder = queryRunner.manager.findOne.mock.invocationCallOrder[0];
    expect(queryRunner.query.mock.invocationCallOrder[crossClientFlagCallIndex]).toBeLessThan(
      aggregateReadOrder,
    );
    expect(queryRunner.query.mock.invocationCallOrder[workspaceFlagCallIndex]).toBeLessThan(
      aggregateReadOrder,
    );

    expect(queryRunner.commitTransaction).toHaveBeenCalled();
    expect(queryRunner.release).toHaveBeenCalled();
  });

  // ---- US-46 scenario 3: a client outside the workspace is refused, with
  // an explicit reason, never silently dropped ----
  it('refuses a client account outside the caller workspace, with an explicit reason', async () => {
    campaignRepo.find.mockResolvedValue([]);

    const result = await service.compareClients('home-1', 'user-1', Role.AGENCY_ADMIN, [
      'acct-1',
      'acct-other-workspace',
    ]);

    expect(result.refused).toEqual([{ client_account_id: 'acct-other-workspace', reason: 'NOT_ACCESSIBLE' }]);
    expect(result.data.map((d: any) => d.client_account_id)).toEqual(['acct-1']);
  });

  // ---- an agency_operator is further restricted to their own
  // operator_client_access grants ----
  it('refuses a client the agency_operator has no operator_client_access grant for', async () => {
    membershipRepo.findOne.mockResolvedValue({ id: 'membership-1' });
    operatorAccessRepo.find.mockResolvedValue([{ accountId: 'acct-1' }]); // only acct-1 granted
    campaignRepo.find.mockResolvedValue([]);

    const result = await service.compareClients('home-1', 'user-1', Role.AGENCY_OPERATOR, [
      'acct-1',
      'acct-2',
    ]);

    expect(result.data.map((d: any) => d.client_account_id)).toEqual(['acct-1']);
    expect(result.refused).toEqual([{ client_account_id: 'acct-2', reason: 'NOT_ACCESSIBLE' }]);
  });

  it('returns a 400 NO_VALID_CLIENTS when every requested client is refused', async () => {
    await expect(
      service.compareClients('home-1', 'user-1', Role.AGENCY_ADMIN, ['acct-other-workspace']),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
