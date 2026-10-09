import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { Campaign } from './campaign.entity';
import { CampaignShortlistEntry } from './campaign-shortlist-entry.entity';

export enum OpportunityStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  DECLINED = 'declined',
  EXPIRED = 'expired',
}

export interface OpportunityDeliverable {
  format: string;
  quantity: number;
  brief_reference?: string;
  [key: string]: any;
}

// One row per creator who was approved and included on the (locked)
// shortlist and has been sent an opportunity (US-28).
@Entity('campaign_opportunity')
@Unique('uq_opportunity', ['campaignId', 'creatorId'])
export class CampaignOpportunity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'campaign_id' })
  campaignId: string;

  @Column({ type: 'uuid', name: 'creator_id' })
  creatorId: string;

  @Column({ type: 'uuid', name: 'shortlist_entry_id' })
  shortlistEntryId: string;

  @Column({ type: 'jsonb' })
  deliverable: OpportunityDeliverable;

  @Column({ type: 'numeric', name: 'payout_gross' })
  payoutGross: string;

  @Column({ type: 'numeric', name: 'payout_commission' })
  payoutCommission: string;

  @Column({ type: 'numeric', name: 'payout_net' })
  payoutNet: string;

  @Column({ type: 'timestamptz', name: 'expires_at' })
  expiresAt: Date;

  @Column({ type: 'text', enum: OpportunityStatus, default: OpportunityStatus.PENDING })
  status: OpportunityStatus;

  @Column({ type: 'timestamptz', nullable: true, name: 'responded_at' })
  respondedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => Campaign)
  @JoinColumn({ name: 'campaign_id' })
  campaign: Campaign;

  @ManyToOne(() => CampaignShortlistEntry)
  @JoinColumn({ name: 'shortlist_entry_id' })
  shortlistEntry: CampaignShortlistEntry;
}
