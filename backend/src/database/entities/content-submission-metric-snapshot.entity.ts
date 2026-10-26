import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { ContentSubmission } from './content-submission.entity';

export enum IngestionStatus {
  PENDING_FIRST_PULL = 'pending_first_pull',
  FRESH = 'fresh',
  STALE_RATE_LIMITED = 'stale_rate_limited',
  STALE_UNREACHABLE = 'stale_unreachable',
  STALE_AUTH_REVOKED = 'stale_auth_revoked',
}

// FR-52's read-facing half (section 2.2 of the E7 architecture doc): the
// current, best-known reach/engagement/impressions for one exact published
// piece of content. Created lazily by discover-and-ingest-metrics the first
// time it finds a content_submission with published_at set and no snapshot
// row yet (ADR-0045) -- this epic never writes to content_submission itself.
// reach/engagement/impressions hold the last-known values and are never
// blanked by a later failed pull (NFR-35); only ingestion_status and the
// timestamp fields change on failure.
@Entity('content_submission_metric_snapshot')
export class ContentSubmissionMetricSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', unique: true, name: 'content_submission_id' })
  contentSubmissionId: string;

  @Column({ type: 'uuid', name: 'campaign_id' })
  campaignId: string;

  @Column({ type: 'uuid', name: 'creator_id' })
  creatorId: string;

  @Column({ type: 'text' })
  platform: string;

  @Column({ type: 'int', nullable: true })
  reach: number | null;

  @Column({ type: 'int', nullable: true })
  engagement: number | null;

  @Column({ type: 'int', nullable: true })
  impressions: number | null;

  @Column({
    type: 'text',
    enum: IngestionStatus,
    default: IngestionStatus.PENDING_FIRST_PULL,
    name: 'ingestion_status',
  })
  ingestionStatus: IngestionStatus;

  @Column({ type: 'timestamptz', nullable: true, name: 'last_successful_pull_at' })
  lastSuccessfulPullAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'last_attempted_pull_at' })
  lastAttemptedPullAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'next_retry_at' })
  nextRetryAt: Date | null;

  @Column({ type: 'int', default: 0, name: 'consecutive_failure_count' })
  consecutiveFailureCount: number;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => ContentSubmission)
  @JoinColumn({ name: 'content_submission_id' })
  contentSubmission: ContentSubmission;
}
