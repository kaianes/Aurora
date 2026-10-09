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
import { AudienceTargeting } from './campaign.entity';

export interface TimelineShape {
  duration_days: number;
}

export interface BrandProfileSnapshot {
  prohibited_topics: string[] | null;
  tone_of_voice: string | null;
}

@Entity('campaign_template')
export class CampaignTemplate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'account_id' })
  accountId: string;

  @Column({ type: 'uuid', nullable: true, name: 'source_campaign_id' })
  sourceCampaignId: string | null;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'jsonb', nullable: true, name: 'audience_targeting' })
  audienceTargeting: AudienceTargeting | null;

  @Column({ type: 'text', nullable: true })
  message: string | null;

  @Column({ type: 'jsonb', nullable: true, name: 'deliverable_formats' })
  deliverableFormats: string[] | null;

  @Column({ type: 'jsonb', nullable: true, name: 'timeline_shape' })
  timelineShape: TimelineShape | null;

  @Column({ type: 'jsonb', nullable: true, name: 'brand_profile_snapshot' })
  brandProfileSnapshot: BrandProfileSnapshot | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => Account)
  @JoinColumn({ name: 'account_id' })
  account: Account;
}
