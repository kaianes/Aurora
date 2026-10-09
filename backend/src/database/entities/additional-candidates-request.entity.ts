import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Campaign } from './campaign.entity';
import { CampaignShortlist } from './campaign-shortlist.entity';

export enum AdditionalCandidatesRequestStatus {
  PENDING = 'pending',
  FULFILLED = 'fulfilled',
  NO_ADDITIONAL_CANDIDATES = 'no_additional_candidates',
}

// Created when rejections drop the approved pool below the guaranteed
// minimum and the buyer explicitly asks for more candidates (US-13 scenario
// 2). A top-up against the existing shortlist and locked price, never a new
// quote (ADR-0018).
@Entity('additional_candidates_request')
export class AdditionalCandidatesRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'campaign_id' })
  campaignId: string;

  @Column({ type: 'uuid', name: 'shortlist_id' })
  shortlistId: string;

  @Column({ type: 'int', name: 'requested_count' })
  requestedCount: number;

  @Column({
    type: 'text',
    enum: AdditionalCandidatesRequestStatus,
    default: AdditionalCandidatesRequestStatus.PENDING,
  })
  status: AdditionalCandidatesRequestStatus;

  @Column({ type: 'uuid', name: 'requested_by_user_id' })
  requestedByUserId: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @Column({ type: 'timestamptz', nullable: true, name: 'resolved_at' })
  resolvedAt: Date | null;

  @ManyToOne(() => Campaign)
  @JoinColumn({ name: 'campaign_id' })
  campaign: Campaign;

  @ManyToOne(() => CampaignShortlist)
  @JoinColumn({ name: 'shortlist_id' })
  shortlist: CampaignShortlist;
}
