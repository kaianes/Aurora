import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Campaign } from './campaign.entity';

export enum BriefingStatus {
  DRAFT = 'draft',
  ISSUED = 'issued',
}

export interface DeliverableSpec {
  format: string;
  quantity?: number;
  aspect_ratio?: string;
  caption_length_limit?: number;
  mandatory_hashtags?: string[];
  notes?: string;
  [key: string]: any;
}

// One row per campaign (section 3.2 of the E5 architecture doc). Created
// lazily on Marina's first save, same draft-lifecycle precedent as
// brand_profile and safety_ruleset. Immutable once issued (US-18a).
@Entity('briefing')
export class Briefing {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'campaign_id' })
  campaignId: string;

  @Column({ type: 'jsonb', nullable: true })
  dos: string[] | null;

  @Column({ type: 'jsonb', nullable: true })
  donts: string[] | null;

  @Column({ type: 'jsonb', nullable: true, name: 'reference_examples' })
  referenceExamples: string[] | null;

  @Column({ type: 'jsonb', nullable: true, name: 'deliverable_spec' })
  deliverableSpec: DeliverableSpec | null;

  @Column({ type: 'timestamptz', nullable: true })
  deadline: Date | null;

  @Column({ type: 'text', enum: BriefingStatus, default: BriefingStatus.DRAFT })
  status: BriefingStatus;

  @Column({ type: 'timestamptz', nullable: true, name: 'issued_at' })
  issuedAt: Date | null;

  @Column({ type: 'uuid', nullable: true, name: 'issued_by_user_id' })
  issuedByUserId: string | null;

  @Column({ type: 'uuid', name: 'created_by_user_id' })
  createdByUserId: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => Campaign)
  @JoinColumn({ name: 'campaign_id' })
  campaign: Campaign;
}
