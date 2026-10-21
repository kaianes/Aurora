import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export enum LedgerReferenceType {
  PAYOUT_OBLIGATION = 'payout_obligation',
  INVOICE = 'invoice',
}

export enum LedgerDirection {
  DEBIT = 'debit',
  CREDIT = 'credit',
}

// The concrete realization of docs/architecture.md's top-level
// LEDGER_ENTRY: append-only, double-entry (DB trigger, section 3.6 of the
// E6 architecture doc), written only in balanced debit/credit pairs sharing
// one transaction_id, by exactly one service, LedgerService
// (ADR-0037). Written only on an obligation's actual settlement -- never
// on creation, never on a failed attempt.
@Entity('ledger_entry')
export class LedgerEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'transaction_id' })
  transactionId: string;

  @Column({ type: 'uuid', name: 'campaign_id' })
  campaignId: string;

  @Column({ type: 'text', enum: LedgerReferenceType, name: 'reference_type' })
  referenceType: LedgerReferenceType;

  @Column({ type: 'uuid', name: 'reference_id' })
  referenceId: string;

  @Column({ type: 'text', enum: LedgerDirection })
  direction: LedgerDirection;

  @Column({ type: 'numeric' })
  amount: string;

  @Column({ type: 'text' })
  description: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
