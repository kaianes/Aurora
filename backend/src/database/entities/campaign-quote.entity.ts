import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Campaign } from './campaign.entity';

export enum CampaignQuoteStatus {
  PENDING = 'pending',
  READY = 'ready',
  FAILED = 'failed',
  NO_VIABLE_POOL = 'no_viable_pool',
}

@Entity('campaign_quote')
export class CampaignQuote {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'campaign_id' })
  campaignId: string;

  @Column({ type: 'text', enum: CampaignQuoteStatus, default: CampaignQuoteStatus.PENDING })
  status: CampaignQuoteStatus;

  @Column({ type: 'int', nullable: true, name: 'guaranteed_min_pool_size' })
  guaranteedMinPoolSize: number | null;

  @Column({ type: 'int', nullable: true, name: 'projected_reach_low' })
  projectedReachLow: number | null;

  @Column({ type: 'int', nullable: true, name: 'projected_reach_high' })
  projectedReachHigh: number | null;

  @Column({ type: 'numeric', nullable: true, name: 'total_price' })
  totalPrice: string | null;

  @Column({ type: 'text', nullable: true, name: 'failure_reason' })
  failureReason: string | null;

  @Column({ type: 'boolean', default: false, name: 'superseded' })
  superseded: boolean;

  @CreateDateColumn({ type: 'timestamptz', name: 'requested_at' })
  requestedAt: Date;

  @Column({ type: 'timestamptz', nullable: true, name: 'resolved_at' })
  resolvedAt: Date | null;

  @ManyToOne(() => Campaign)
  @JoinColumn({ name: 'campaign_id' })
  campaign: Campaign;
}
