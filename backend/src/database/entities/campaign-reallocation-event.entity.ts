import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Campaign } from './campaign.entity';

export enum ReallocationTrigger {
  SCHEDULED = 'scheduled',
  MANUAL = 'manual',
}

export enum ReallocationOutcome {
  APPLIED = 'applied',
  SKIPPED_STALE_METRICS = 'skipped_stale_metrics',
  SKIPPED_NO_DATA = 'skipped_no_data',
}

@Entity('campaign_reallocation_event')
export class CampaignReallocationEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'campaign_id' })
  campaignId: string;

  @Column({ type: 'jsonb', default: {}, name: 'before_allocations' })
  beforeAllocations: Record<string, string>;

  @Column({ type: 'jsonb', default: {}, name: 'after_allocations' })
  afterAllocations: Record<string, string>;

  @Column({ type: 'text', enum: ReallocationTrigger })
  trigger: ReallocationTrigger;

  @Column({ type: 'text', enum: ReallocationOutcome })
  outcome: ReallocationOutcome;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => Campaign)
  @JoinColumn({ name: 'campaign_id' })
  campaign: Campaign;
}
