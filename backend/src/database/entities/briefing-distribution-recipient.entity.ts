import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { Briefing } from './briefing.entity';
import { Campaign } from './campaign.entity';

export enum DistributionRecipientStatus {
  PENDING = 'pending',
  DELIVERED = 'delivered',
  FAILED = 'failed',
}

// A point-in-time snapshot of who one issue action reached, decoupled from
// live view access (ADR-0029). One row per creator holding a
// campaign_opportunity for the campaign at the moment of issuing, regardless
// of that opportunity's own status (section 3.2 of the E5 architecture doc).
@Entity('briefing_distribution_recipient')
@Unique('uq_distribution_recipient', ['briefingId', 'creatorId'])
export class BriefingDistributionRecipient {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'briefing_id' })
  briefingId: string;

  @Column({ type: 'uuid', name: 'campaign_id' })
  campaignId: string;

  @Column({ type: 'uuid', name: 'creator_id' })
  creatorId: string;

  @Column({ type: 'uuid', name: 'opportunity_id' })
  opportunityId: string;

  @Column({ type: 'text', enum: DistributionRecipientStatus, default: DistributionRecipientStatus.PENDING })
  status: DistributionRecipientStatus;

  @Column({ type: 'text', nullable: true, name: 'failure_reason' })
  failureReason: string | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'delivered_at' })
  deliveredAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => Briefing)
  @JoinColumn({ name: 'briefing_id' })
  briefing: Briefing;

  @ManyToOne(() => Campaign)
  @JoinColumn({ name: 'campaign_id' })
  campaign: Campaign;
}
