import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { PayoutObligation } from './payout-obligation.entity';

export enum TaxDocumentStatus {
  GENERATED = 'generated',
  BLOCKED_MISSING_INFO = 'blocked_missing_info',
}

// US-36b / FR-50's entity (ADR-0041, Brazil-only pilot scope). Created when
// a payout_obligation transitions to settled. Unique on
// payout_obligation_id -- one document per payout, never merged across
// payouts in the same period (US-36b scenario 2).
@Entity('tax_document')
export class TaxDocument {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', unique: true, name: 'payout_obligation_id' })
  payoutObligationId: string;

  @Column({ type: 'uuid', name: 'creator_id' })
  creatorId: string;

  @Column({ type: 'text', enum: TaxDocumentStatus })
  status: TaxDocumentStatus;

  @Column({ type: 'jsonb', nullable: true, name: 'missing_fields' })
  missingFields: string[] | null;

  @Column({ type: 'text', nullable: true, name: 'document_url' })
  documentUrl: string | null;

  @Column({ type: 'text', name: 'tax_period' })
  taxPeriod: string;

  @Column({ type: 'timestamptz', nullable: true, name: 'generated_at' })
  generatedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @OneToOne(() => PayoutObligation)
  @JoinColumn({ name: 'payout_obligation_id' })
  payoutObligation: PayoutObligation;
}
