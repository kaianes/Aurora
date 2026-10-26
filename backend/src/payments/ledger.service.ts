import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LedgerEntry, LedgerDirection, LedgerReferenceType } from '../database/entities';

export interface RecordBalancedEntryInput {
  transactionId: string; // caller-generated, groups the pair
  campaignId: string;
  referenceType: LedgerReferenceType;
  referenceId: string;
  amount: string; // BRL, positive
  debitDescription: string;
  creditDescription: string;
}

// ADR-0037: exactly one service may write to ledger_entry, and its only
// write method is recordBalancedEntry. It always writes exactly two rows --
// one debit, one credit, both sharing transactionId/campaignId/
// referenceType/referenceId and the same amount -- inside a single database
// transaction, so a crash can never leave one leg written without the
// other. There is no generic "insert a row" method exposed at all.
@Injectable()
export class LedgerService {
  constructor(private dataSource: DataSource) {}

  async recordBalancedEntry(input: RecordBalancedEntryInput): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const debit = manager.create(LedgerEntry, {
        transactionId: input.transactionId,
        campaignId: input.campaignId,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        direction: LedgerDirection.DEBIT,
        amount: input.amount,
        description: input.debitDescription,
      });
      const credit = manager.create(LedgerEntry, {
        transactionId: input.transactionId,
        campaignId: input.campaignId,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        direction: LedgerDirection.CREDIT,
        amount: input.amount,
        description: input.creditDescription,
      });
      await manager.save(LedgerEntry, [debit, credit]);
    });
  }
}
