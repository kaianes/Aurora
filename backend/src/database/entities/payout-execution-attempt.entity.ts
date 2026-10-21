import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { PayoutObligation } from './payout-obligation.entity';

export enum PayoutExecutionTrigger {
  SCHEDULED = 'scheduled',
  MANUAL = 'manual',
}

export enum PayoutExecutionOutcome {
  INSTRUCTED = 'instructed',
  FAILED = 'failed',
}

// Append-only log of every call this epic's code makes to
// PayoutExecutionAdapter.executeTransfer (ADR-0033), one row per attempt.
// idempotency_key is always payout_obligation_id (docs/architecture.md's
// S-02). Never the source of the obligation's own status -- a historical
// trail only, read for ops/reconciliation purposes (section 3.2 of the E6
// architecture doc).
@Entity('payout_execution_attempt')
export class PayoutExecutionAttempt {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'payout_obligation_id' })
  payoutObligationId: string;

  @Column({ type: 'text', name: 'idempotency_key' })
  idempotencyKey: string;

  @Column({ type: 'text', enum: PayoutExecutionTrigger })
  trigger: PayoutExecutionTrigger;

  @Column({ type: 'uuid', nullable: true, name: 'triggered_by_user_id' })
  triggeredByUserId: string | null;

  @Column({ type: 'text', enum: PayoutExecutionOutcome })
  outcome: PayoutExecutionOutcome;

  @Column({ type: 'text', nullable: true, name: 'failure_reason' })
  failureReason: string | null;

  @Column({ type: 'text', nullable: true, name: 'provider_reference' })
  providerReference: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => PayoutObligation)
  @JoinColumn({ name: 'payout_obligation_id' })
  payoutObligation: PayoutObligation;
}
