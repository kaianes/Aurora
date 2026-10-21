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

// One thread per (briefing, creator) pair, created lazily on that creator's
// first question (ADR-0028). Privacy is a property of this unique
// constraint, never a runtime filter.
@Entity('briefing_qa_thread')
@Unique('uq_qa_thread', ['briefingId', 'creatorId'])
export class BriefingQaThread {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'briefing_id' })
  briefingId: string;

  @Column({ type: 'uuid', name: 'campaign_id' })
  campaignId: string;

  @Column({ type: 'uuid', name: 'creator_id' })
  creatorId: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => Briefing)
  @JoinColumn({ name: 'briefing_id' })
  briefing: Briefing;

  @ManyToOne(() => Campaign)
  @JoinColumn({ name: 'campaign_id' })
  campaign: Campaign;
}
