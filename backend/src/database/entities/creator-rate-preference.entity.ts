import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

// US-27 / ADR-0058. Current-value table, one row per (creator_id,
// deliverable_format), upserted on save, no history table -- the
// non-retroactivity guarantee already rides on E3's existing
// prevent_opportunity_payout_mutation trigger, not on anything this table
// does.
@Entity('creator_rate_preference')
export class CreatorRatePreference {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'creator_id' })
  creatorId: string;

  @Column({ type: 'text', name: 'deliverable_format' })
  deliverableFormat: string;

  @Column({ type: 'numeric', name: 'rate_amount' })
  rateAmount: string;

  @Column({ type: 'text', default: 'BRL' })
  currency: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
