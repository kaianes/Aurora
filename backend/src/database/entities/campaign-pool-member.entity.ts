import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { Campaign } from './campaign.entity';

export enum PoolMemberStatus {
  PENDING_PUBLISH = 'pending_publish',
  PUBLISHED = 'published',
  REALLOCATION_ELIGIBLE = 'reallocation_eligible',
  EXCLUDED = 'excluded',
}

@Entity('campaign_pool_member')
@Unique('uq_pool_member', ['campaignId', 'creatorId'])
export class CampaignPoolMember {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'campaign_id' })
  campaignId: string;

  @Column({ type: 'uuid', name: 'creator_id' })
  creatorId: string;

  @Column({ type: 'numeric', name: 'allocated_budget' })
  allocatedBudget: string;

  @Column({ type: 'numeric', name: 'original_budget' })
  originalBudget: string;

  @Column({ type: 'numeric', default: '0', name: 'committed_budget' })
  committedBudget: string;

  @Column({ type: 'text', enum: PoolMemberStatus, default: PoolMemberStatus.PENDING_PUBLISH })
  status: PoolMemberStatus;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => Campaign)
  @JoinColumn({ name: 'campaign_id' })
  campaign: Campaign;
}
