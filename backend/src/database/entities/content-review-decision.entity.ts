import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { ContentSubmission } from './content-submission.entity';
import { Campaign } from './campaign.entity';

export enum ContentReviewDecisionValue {
  APPROVED = 'approved',
  REJECTED = 'rejected',
  REVISION_REQUESTED = 'revision_requested',
}

// Marina's (or a teammate's) decision on one exact submission version
// (ADR-0026) -- a separate record from E4's safety_review_queue_item,
// answering a separate question ("is this the creative work we want" vs
// "is this safe to publish"). Unique on content_submission_id: a decision
// is final for that exact version.
@Entity('content_review_decision')
export class ContentReviewDecision {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'content_submission_id' })
  contentSubmissionId: string;

  @Column({ type: 'uuid', name: 'campaign_id' })
  campaignId: string;

  @Column({ type: 'text', enum: ContentReviewDecisionValue })
  decision: ContentReviewDecisionValue;

  @Column({ type: 'text', nullable: true, name: 'decision_reason' })
  decisionReason: string | null;

  @Column({ type: 'uuid', name: 'decided_by_user_id' })
  decidedByUserId: string;

  @Column({ type: 'timestamptz', name: 'decided_at' })
  decidedAt: Date;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => ContentSubmission)
  @JoinColumn({ name: 'content_submission_id' })
  contentSubmission: ContentSubmission;

  @ManyToOne(() => Campaign)
  @JoinColumn({ name: 'campaign_id' })
  campaign: Campaign;
}
