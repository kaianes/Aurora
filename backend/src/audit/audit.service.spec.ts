import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuditService } from './audit.service';

function mockQueryBuilder(rows: any[]) {
  const qb: any = {
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    addOrderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    getMany: vi.fn().mockResolvedValue(rows),
  };
  return qb;
}

describe('AuditService - FR-60 audit log read path', () => {
  let service: AuditService;
  let auditLogRepository: { create: ReturnType<typeof vi.fn>; save: ReturnType<typeof vi.fn>; createQueryBuilder: ReturnType<typeof vi.fn> };
  let userRepository: { find: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    auditLogRepository = {
      create: vi.fn((data: any) => ({ ...data })),
      save: vi.fn((entity: any) => Promise.resolve({ id: '1', ...entity })),
      createQueryBuilder: vi.fn(),
    };
    userRepository = { find: vi.fn().mockResolvedValue([]) };

    service = new AuditService(auditLogRepository as any, userRepository as any);
  });

  // ---- log() is unchanged by this epic -- a regression guard, not new
  // coverage, since no spec file existed for this method before. ----
  it('writes an audit log entry with the given fields', async () => {
    await service.log({
      actorUserId: 'user-1',
      targetAccountId: 'acct-1',
      action: 'client_account.created',
      metadata: { foo: 'bar' },
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
    });

    expect(auditLogRepository.save).toHaveBeenCalled();
    const created = auditLogRepository.create.mock.calls[0][0];
    expect(created.action).toBe('client_account.created');
    expect(created.metadata).toEqual({ foo: 'bar' });
  });

  // ---- FR-60 scenario 1: a chronological, paginated list scoped to one
  // client account, each entry attributed to its acting user. ----
  it('returns audit entries for the requested account, joined to their actor', async () => {
    const rows = [
      {
        id: '8842',
        actorUserId: 'user-1',
        action: 'operator_access.granted',
        metadata: { operator_user_id: 'op-1' },
        createdAt: new Date('2026-10-20T09:00:00Z'),
      },
      {
        id: '8810',
        actorUserId: null,
        action: 'campaign_template.copied',
        metadata: { source_account_id: 'y1y1' },
        createdAt: new Date('2026-10-19T15:30:00Z'),
      },
    ];
    const qb = mockQueryBuilder(rows);
    auditLogRepository.createQueryBuilder.mockReturnValue(qb);
    userRepository.find.mockResolvedValue([
      { id: 'user-1', name: 'Renata Alves', email: 'renata@agenciacriativa.com.br' },
    ]);

    const result = await service.listForAccount('acct-1');

    expect(qb.where).toHaveBeenCalledWith('a.targetAccountId = :accountId', { accountId: 'acct-1' });
    expect(result.data).toHaveLength(2);
    expect(result.data[0]).toEqual({
      id: '8842',
      actor_user_id: 'user-1',
      actor_name: 'Renata Alves',
      actor_email: 'renata@agenciacriativa.com.br',
      action: 'operator_access.granted',
      metadata: { operator_user_id: 'op-1' },
      created_at: '2026-10-20T09:00:00.000Z',
    });
    // A null actor_user_id (a system-attributed action) resolves to null
    // actor fields, never an error or a fabricated default.
    expect(result.data[1].actor_user_id).toBeNull();
    expect(result.data[1].actor_name).toBeNull();
    expect(result.data[1].actor_email).toBeNull();
    expect(result.pagination).toEqual({ next_cursor: null, has_more: false });
  });

  // ---- Pagination: a full page signals has_more and returns the last
  // row's id as next_cursor, mirroring campaign.service's own convention. ----
  it('signals has_more and returns the last row id as next_cursor when more rows exist than the page size', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({
      id: String(100 - i),
      actorUserId: null,
      action: 'authorization.denied',
      metadata: {},
      createdAt: new Date('2026-10-20T09:00:00Z'),
    }));
    const qb = mockQueryBuilder(rows);
    auditLogRepository.createQueryBuilder.mockReturnValue(qb);

    const result = await service.listForAccount('acct-1', undefined, 2);

    expect(qb.limit).toHaveBeenCalledWith(3);
    expect(result.data).toHaveLength(2);
    expect(result.pagination).toEqual({ next_cursor: '99', has_more: true });
  });

  // ---- A limit above the documented maximum (100) is clamped, not passed
  // straight through to the database (FR-60, section 5.4). ----
  it('clamps limit to the documented maximum of 100', async () => {
    const qb = mockQueryBuilder([]);
    auditLogRepository.createQueryBuilder.mockReturnValue(qb);

    await service.listForAccount('acct-1', undefined, 500);

    expect(qb.limit).toHaveBeenCalledWith(101);
  });

  // ---- A cursor is applied as an additional id filter, scoping the next
  // page strictly before the given id. ----
  it('applies the cursor as an id filter for the next page', async () => {
    const qb = mockQueryBuilder([]);
    auditLogRepository.createQueryBuilder.mockReturnValue(qb);

    await service.listForAccount('acct-1', '8810', 20);

    expect(qb.andWhere).toHaveBeenCalledWith('a.id < :cursor', { cursor: '8810' });
  });
});
