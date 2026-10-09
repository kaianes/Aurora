import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Account } from './account.entity';

export enum CampaignState {
  DRAFT = 'draft',
  QUOTED = 'quoted',
  CONFIRMED = 'confirmed',
  ACTIVE = 'active',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

export interface AudienceTargeting {
  geography?: string[];
  age_range?: [number, number];
  interests?: string[];
  gender?: string;
  [key: string]: any;
}

@Entity('campaign')
export class Campaign {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'account_id' })
  accountId: string;

  @Column({ type: 'uuid', name: 'created_by_user_id' })
  createdByUserId: string;

  @Column({ type: 'uuid', nullable: true, name: 'template_id' })
  templateId: string | null;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text', enum: CampaignState, default: CampaignState.DRAFT })
  state: CampaignState;

  @Column({ type: 'numeric', nullable: true, name: 'budget_amount' })
  budgetAmount: string | null;

  @Column({ type: 'text', default: 'BRL', name: 'budget_currency' })
  budgetCurrency: string;

  @Column({ type: 'jsonb', nullable: true, name: 'audience_targeting' })
  audienceTargeting: AudienceTargeting | null;

  @Column({ type: 'text', nullable: true })
  message: string | null;

  @Column({ type: 'jsonb', nullable: true, name: 'deliverable_formats' })
  deliverableFormats: string[] | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'timeline_start' })
  timelineStart: Date | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'timeline_end' })
  timelineEnd: Date | null;

  @Column({ type: 'text', nullable: true, name: 'missing_fields' })
  missingFields: string | null;

  @Column({ type: 'numeric', nullable: true, name: 'locked_price' })
  lockedPrice: string | null;

  @Column({ type: 'int', nullable: true, name: 'guaranteed_min_pool_size' })
  guaranteedMinPoolSize: number | null;

  @Column({ type: 'jsonb', nullable: true, name: 'brand_profile_drift' })
  brandProfileDrift: string[] | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => Account)
  @JoinColumn({ name: 'account_id' })
  account: Account;
}
