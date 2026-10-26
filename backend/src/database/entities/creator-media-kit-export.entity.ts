import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

export enum MediaKitExportStatus {
  PENDING = 'pending',
  READY = 'ready',
  FAILED = 'failed',
}

// US-25 / ADR-0057. Request-response audit row, mirroring E2's
// campaign_quote, E3's campaign_shortlist, and E7's
// campaign_performance_report pattern exactly: status pending -> ready |
// failed, polled by the frontend.
@Entity('creator_media_kit_export')
export class CreatorMediaKitExport {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'creator_id' })
  creatorId: string;

  @Column({ type: 'text', enum: MediaKitExportStatus, default: MediaKitExportStatus.PENDING })
  status: MediaKitExportStatus;

  @Column({ type: 'boolean', nullable: true, name: 'has_campaign_history' })
  hasCampaignHistory: boolean | null;

  @Column({ type: 'text', nullable: true, name: 'pdf_document_url' })
  pdfDocumentUrl: string | null;

  @Column({ type: 'text', nullable: true, name: 'failure_reason' })
  failureReason: string | null;

  @Column({ type: 'timestamptz', name: 'requested_at' })
  requestedAt: Date;

  @Column({ type: 'timestamptz', nullable: true, name: 'resolved_at' })
  resolvedAt: Date | null;
}
