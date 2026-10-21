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

export enum MonitoringStatus {
  ACTIVE = 'active',
  STOPPED = 'stopped',
}

export enum MonitoringResult {
  MATCHING = 'matching',
  DEVIATED = 'deviated',
  UNREACHABLE = 'unreachable',
}

// Created once, when BrandSafetyGateService.recordPublication is called
// after a submission's gate has cleared (section 2.2 of the E4 architecture
// doc, section 3.6). approved_* fields are a snapshot taken at that moment.
// No history table behind last_result/deviation_details -- each monitoring
// cycle overwrites the previous result (ADR-0024).
@Entity('published_content_snapshot')
export class PublishedContentSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', unique: true, name: 'content_submission_id' })
  contentSubmissionId: string;

  @Column({ type: 'text', name: 'published_url' })
  publishedUrl: string;

  @Column({ type: 'text', name: 'approved_caption_text' })
  approvedCaptionText: string;

  @Column({ type: 'text', nullable: true, name: 'approved_on_screen_text' })
  approvedOnScreenText: string | null;

  @Column({ type: 'text', nullable: true, name: 'approved_audio_transcript' })
  approvedAudioTranscript: string | null;

  @Column({
    type: 'text',
    enum: MonitoringStatus,
    default: MonitoringStatus.ACTIVE,
    name: 'monitoring_status',
  })
  monitoringStatus: MonitoringStatus;

  @Column({ type: 'timestamptz', nullable: true, name: 'last_checked_at' })
  lastCheckedAt: Date | null;

  @Column({ type: 'text', enum: MonitoringResult, nullable: true, name: 'last_result' })
  lastResult: MonitoringResult | null;

  @Column({ type: 'jsonb', nullable: true, name: 'deviation_details' })
  deviationDetails: Record<string, any> | null;

  @Column({ type: 'int', default: 0, name: 'consecutive_unreachable_count' })
  consecutiveUnreachableCount: number;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => ContentSubmission)
  @JoinColumn({ name: 'content_submission_id' })
  contentSubmission: ContentSubmission;
}
