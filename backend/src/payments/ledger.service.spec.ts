import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LedgerService } from './ledger.service';
import { LedgerDirection, LedgerReferenceType } from '../database/entities';

describe('LedgerService - ADR-0037', () => {
  let service: LedgerService;
  let manager: { create: ReturnType<typeof vi.fn>; save: ReturnType<typeof vi.fn> };
  let dataSource: { transaction: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    manager = {
      create: vi.fn((_entity: any, data: any) => data),
      save: vi.fn().mockResolvedValue(undefined),
    };
    dataSource = {
      transaction: vi.fn((cb: any) => cb(manager)),
    };
    service = new LedgerService(dataSource as any);
  });

  it('always writes exactly one debit leg and one credit leg sharing the same transaction/campaign/reference', async () => {
    await service.recordBalancedEntry({
      transactionId: 'txn-1',
      campaignId: 'camp-1',
      referenceType: LedgerReferenceType.PAYOUT_OBLIGATION,
      referenceId: 'pay-1',
      amount: '680.00',
      debitDescription: 'debit leg',
      creditDescription: 'credit leg',
    });

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(manager.save).toHaveBeenCalledTimes(1);

    const [, savedRows] = manager.save.mock.calls[0];
    expect(savedRows).toHaveLength(2);

    const debit = savedRows.find((r: any) => r.direction === LedgerDirection.DEBIT);
    const credit = savedRows.find((r: any) => r.direction === LedgerDirection.CREDIT);

    expect(debit).toMatchObject({
      transactionId: 'txn-1',
      campaignId: 'camp-1',
      referenceType: LedgerReferenceType.PAYOUT_OBLIGATION,
      referenceId: 'pay-1',
      amount: '680.00',
      description: 'debit leg',
    });
    expect(credit).toMatchObject({
      transactionId: 'txn-1',
      campaignId: 'camp-1',
      referenceType: LedgerReferenceType.PAYOUT_OBLIGATION,
      referenceId: 'pay-1',
      amount: '680.00',
      description: 'credit leg',
    });
  });

  it('writes both legs inside a single database transaction, never two separate saves', async () => {
    await service.recordBalancedEntry({
      transactionId: 'txn-2',
      campaignId: 'camp-2',
      referenceType: LedgerReferenceType.INVOICE,
      referenceId: 'inv-1',
      amount: '100.00',
      debitDescription: 'd',
      creditDescription: 'c',
    });

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
  });
});
