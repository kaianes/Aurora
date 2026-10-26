import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export enum IngestionAttemptOutcome {
  SUCCESS = 'success',
  RATE_LIMITED = 'rate_limited',
  AUTH_REVOKED = 'auth_revoked',
  UNREACHABLE = 'unreachable',
}

// Append-only log of every call discover-and-ingest-metrics makes to
// SocialMetricsAdapter.pullMetrics (ADR-0044), one row per attempt -- the
// literal unit NFR-08's "20,000 performance events per day" counts. Never
// updated or deleted (same precedent as audit_log, payout_execution_attempt),
// enforced by a database trigger (section 2.6 of the E7 architecture doc).
// Never read by the dashboard, the report, or US-37's endpoint.
@Entity('performance_metric_ingestion_attempt')
export class PerformanceMetricIngestionAttempt {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'content_submission_metric_snapshot_id' })
  contentSubmissionMetricSnapshotId: string;

  @Column({ type: 'uuid', name: 'campaign_id' })
  campaignId: string;

  @Column({ type: 'uuid', name: 'creator_id' })
  creatorId: string;

  @Column({ type: 'timestamptz', name: 'attempted_at' })
  attemptedAt: Date;

  @Column({ type: 'text', enum: IngestionAttemptOutcome })
  outcome: IngestionAttemptOutcome;

  @Column({ type: 'int', nullable: true })
  reach: number | null;

  @Column({ type: 'int', nullable: true })
  engagement: number | null;

  @Column({ type: 'int', nullable: true })
  impressions: number | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
