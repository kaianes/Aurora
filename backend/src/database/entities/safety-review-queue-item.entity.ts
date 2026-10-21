import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { SafetyCheck } from './safety-check.entity';
import { Campaign } from './campaign.entity';
import { ContentSubmission } from './content-submission.entity';

export enum ReviewReasonCategory {
  RULE_VIOLATION = 'rule_violation',
  CHECK_UNAVAILABLE = 'check_unavailable',
}

export enum ReviewItemStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  REVISION_REQUESTED = 'revision_requested',
}

// Created automatically, in the same transaction that sets safety_check.
// status to 'flagged' or 'check_unavailable' (section 2.2 of the E4
// architecture doc). A human decision here never mutates safety_check
// (ADR-0023) -- it is a separate, append-style fact the gate computation
// reads alongside the automated verdict.
@Entity('safety_review_queue_item')
export class SafetyReviewQueueItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', unique: true, name: 'safety_check_id' })
  safetyCheckId: string;

  // Denormalized for RLS join performance (section 2.5 of the E4 architecture doc).
  @Column({ type: 'uuid', name: 'campaign_id' })
  campaignId: string;

  @Column({ type: 'uuid', name: 'content_submission_id' })
  contentSubmissionId: string;

  @Column({ type: 'text', enum: ReviewReasonCategory, name: 'reason_category' })
  reasonCategory: ReviewReasonCategory;

  @Column({ type: 'text', enum: ReviewItemStatus, default: ReviewItemStatus.PENDING })
  status: ReviewItemStatus;

  @Column({ type: 'text', nullable: true, name: 'decision_reason' })
  decisionReason: string | null;

  @Column({ type: 'uuid', nullable: true, name: 'decided_by_user_id' })
  decidedByUserId: string | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'decided_at' })
  decidedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => SafetyCheck)
  @JoinColumn({ name: 'safety_check_id' })
  safetyCheck: SafetyCheck;

  @ManyToOne(() => Campaign)
  @JoinColumn({ name: 'campaign_id' })
  campaign: Campaign;

  @ManyToOne(() => ContentSubmission)
  @JoinColumn({ name: 'content_submission_id' })
  contentSubmission: ContentSubmission;
}
