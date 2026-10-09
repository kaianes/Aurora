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
import { CampaignShortlist } from './campaign-shortlist.entity';

export enum ShortlistEntryOrigin {
  SYSTEM_RANKED = 'system_ranked',
  AGENCY_ADDED = 'agency_added',
}

export enum ShortlistEntryDecision {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

// One row per creator on a campaign's shortlist (section 2.2 of the E3
// architecture doc). `included` is what actually determines whether a
// creator proceeds toward an opportunity; it is distinct from `decision`.
@Entity('campaign_shortlist_entry')
@Unique('uq_shortlist_entry', ['shortlistId', 'creatorId'])
export class CampaignShortlistEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'shortlist_id' })
  shortlistId: string;

  // Denormalized for RLS join performance (section 2.2 of the E3 architecture doc).
  @Column({ type: 'uuid', name: 'campaign_id' })
  campaignId: string;

  @Column({ type: 'uuid', name: 'creator_id' })
  creatorId: string;

  @Column({ type: 'int', nullable: true })
  rank: number | null;

  @Column({ type: 'numeric', nullable: true, name: 'fit_score' })
  fitScore: string | null;

  @Column({ type: 'jsonb', nullable: true, name: 'matched_attributes' })
  matchedAttributes: string[] | null;

  @Column({ type: 'text', enum: ShortlistEntryOrigin, name: 'origin' })
  origin: ShortlistEntryOrigin;

  @Column({ type: 'text', enum: ShortlistEntryDecision, default: ShortlistEntryDecision.PENDING })
  decision: ShortlistEntryDecision;

  @Column({ type: 'uuid', nullable: true, name: 'decision_by_user_id' })
  decisionByUserId: string | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'decision_at' })
  decisionAt: Date | null;

  @Column({ type: 'boolean', default: true })
  included: boolean;

  @Column({ type: 'uuid', nullable: true, name: 'added_by_user_id' })
  addedByUserId: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => CampaignShortlist)
  @JoinColumn({ name: 'shortlist_id' })
  shortlist: CampaignShortlist;
}
