import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Account } from './account.entity';
import { Campaign } from './campaign.entity';

export enum ExclusionType {
  CREATOR = 'creator',
  COMPETITOR_BRAND = 'competitor_brand',
}

// One row per exclusion entry (US-14, ADR-0014). account_id set and
// campaign_id null = brand-level; both set = campaign-level. Both scopes
// apply with OR semantics at shortlist-generation time.
@Entity('creator_exclusion')
export class CreatorExclusion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'account_id' })
  accountId: string;

  @Column({ type: 'uuid', nullable: true, name: 'campaign_id' })
  campaignId: string | null;

  @Column({ type: 'text', enum: ExclusionType, name: 'exclusion_type' })
  exclusionType: ExclusionType;

  @Column({ type: 'uuid', nullable: true, name: 'creator_id' })
  creatorId: string | null;

  @Column({ type: 'text', nullable: true, name: 'competitor_name' })
  competitorName: string | null;

  @Column({ type: 'uuid', name: 'created_by_user_id' })
  createdByUserId: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => Account)
  @JoinColumn({ name: 'account_id' })
  account: Account;

  @ManyToOne(() => Campaign)
  @JoinColumn({ name: 'campaign_id' })
  campaign: Campaign | null;
}
