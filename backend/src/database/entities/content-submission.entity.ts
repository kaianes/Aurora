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
