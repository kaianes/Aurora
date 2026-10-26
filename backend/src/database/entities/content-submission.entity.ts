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

export enum ExtractionStatus {
  NOT_REQUIRED = 'not_required',
  PENDING = 'pending',
  COMPLETE = 'complete',
  FAILED = 'failed',
}

// The minimal entity E4 needs to anchor a safety check (ADR-0020). Not owned
// long-term by E4 -- E5 (FR-39) will own the full draft/version/review
// lifecycle. creator_id and opportunity_id are nullable because, once E5
// exists, draft-submission code calling brand-safety's exported service may
// not always have resolved an opportunity yet.
@Entity('content_submission')
export class ContentSubmission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'campaign_id' })
  campaignId: string;

  @Column({ type: 'uuid', nullable: true, name: 'creator_id' })
  creatorId: string | null;

  @Column({ type: 'uuid', nullable: true, name: 'opportunity_id' })
  opportunityId: string | null;

  @Column({ type: 'text', name: 'caption_text' })
  captionText: string;

  @Column({ type: 'text', nullable: true, name: 'on_screen_text' })
  onScreenText: string | null;

  @Column({ type: 'text', nullable: true, name: 'audio_transcript' })
  audioTranscript: string | null;

  @Column({ type: 'text', nullable: true, name: 'media_asset_url' })
  mediaAssetUrl: string | null;

  @Column({
    type: 'text',
    enum: ExtractionStatus,
    default: ExtractionStatus.NOT_REQUIRED,
    name: 'extraction_status',
  })
  extractionStatus: ExtractionStatus;

  // ---- E5 additive extension (ADR-0025, ADR-0030, ADR-0027) ----

  // Self-referencing version lineage (ADR-0025). The first submission in a
  // lineage has supersedesSubmissionId = null and rootSubmissionId = its own
  // id. A resubmission sets supersedesSubmissionId to the version it
  // replaces, versionNumber to that version's versionNumber + 1, and copies
  // rootSubmissionId forward unchanged.
  @Column({ type: 'uuid', nullable: true, name: 'supersedes_submission_id' })
  supersedesSubmissionId: string | null;

  @Column({ type: 'uuid', nullable: true, name: 'root_submission_id' })
  rootSubmissionId: string | null;

  @Column({ type: 'int', default: 1, name: 'version_number' })
  versionNumber: number;

  // FR-41's deadline/escalation fields (ADR-0030). Set once at submission
  // time; reviewEscalated flips exactly once, by the sweeper job, and is
  // never un-set.
  @Column({ type: 'timestamptz', nullable: true, name: 'review_deadline_at' })
  reviewDeadlineAt: Date | null;

  @Column({ type: 'boolean', default: false, name: 'review_escalated' })
  reviewEscalated: boolean;

  @Column({ type: 'timestamptz', nullable: true, name: 'review_escalated_at' })
  reviewEscalatedAt: Date | null;

  // FR-42's completion marker on the exact version confirmed (ADR-0027).
  @Column({ type: 'text', nullable: true, name: 'published_url' })
  publishedUrl: string | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'published_at' })
  publishedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'submitted_at' })
  submittedAt: Date;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => Campaign)
  @JoinColumn({ name: 'campaign_id' })
  campaign: Campaign;
}
