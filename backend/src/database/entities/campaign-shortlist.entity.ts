import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { Campaign } from './campaign.entity';

export enum ShortlistStatus {
  PENDING = 'pending',
  READY = 'ready',
  FAILED = 'failed',
  NO_VIABLE_POOL = 'no_viable_pool',
}

export enum ShortlistLockedReason {
  AGENCY_OVERRIDE = 'agency_override',
  CAMPAIGN_ACTIVATED = 'campaign_activated',
}

// One row per campaign, the current authoritative shortlist (section 2.2 of
// the E3 architecture doc). Regenerating replaces this row's own status and
// entries; it never creates a second campaign_shortlist row for the same
// campaign (uq_campaign_shortlist).
@Entity('campaign_shortlist')
export class CampaignShortlist {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', unique: true, name: 'campaign_id' })
  campaignId: string;

  @Column({ type: 'text', enum: ShortlistStatus, default: ShortlistStatus.PENDING })
  status: ShortlistStatus;

  @Column({ type: 'text', nullable: true, name: 'failure_reason' })
  failureReason: string | null;

  @Column({ type: 'boolean', default: false, name: 'below_guaranteed_minimum' })
  belowGuaranteedMinimum: boolean;

  @Column({ type: 'boolean', default: false })
  locked: boolean;

  @Column({ type: 'text', nullable: true, enum: ShortlistLockedReason, name: 'locked_reason' })
  lockedReason: ShortlistLockedReason | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'locked_at' })
  lockedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'requested_at' })
  requestedAt: Date;

  @Column({ type: 'timestamptz', nullable: true, name: 'resolved_at' })
  resolvedAt: Date | null;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;

  @OneToOne(() => Campaign)
  @JoinColumn({ name: 'campaign_id' })
  campaign: Campaign;
}
