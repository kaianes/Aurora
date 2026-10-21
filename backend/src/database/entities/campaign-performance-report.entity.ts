import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export enum PerformanceReportStatus {
  PENDING = 'pending',
  READY = 'ready',
  FAILED = 'failed',
}

export enum SpendSource {
  LOCKED_PRICE = 'locked_price',
  INVOICE = 'invoice',
}

export enum CampaignProgressLabel {
  IN_PROGRESS = 'in_progress',
  FINAL = 'final',
}

// US-22 / FR-53's export entity. A request-response audit row mirroring
// E2's campaign_quote and E3's campaign_shortlist pattern (status:
// pending -> ready | failed, polled by the frontend). Cost-efficiency
// fields are null, never zero, whenever has_deliveries is false (ADR-0046),
// tied structurally to has_deliveries by a database constraint (section 2.6
// of the E7 architecture doc), not only by service-layer discipline.
@Entity('campaign_performance_report')
export class CampaignPerformanceReport {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'campaign_id' })
  campaignId: string;

  @Column({ type: 'text', enum: PerformanceReportStatus, default: PerformanceReportStatus.PENDING })
  status: PerformanceReportStatus;

  @Column({ type: 'boolean', nullable: true, name: 'has_deliveries' })
  hasDeliveries: boolean | null;

  @Column({ type: 'numeric', nullable: true, name: 'spend_amount' })
  spendAmount: string | null;

  @Column({ type: 'text', enum: SpendSource, nullable: true, name: 'spend_source' })
  spendSource: SpendSource | null;

  @Column({ type: 'int', nullable: true, name: 'total_delivered_reach' })
  totalDeliveredReach: number | null;

  @Column({ type: 'int', nullable: true, name: 'total_delivered_engagement' })
  totalDeliveredEngagement: number | null;

  @Column({ type: 'numeric', nullable: true, name: 'cost_per_engagement' })
  costPerEngagement: string | null;

  @Column({ type: 'numeric', nullable: true, name: 'cpm_equivalent' })
  cpmEquivalent: string | null;

  @Column({
    type: 'text',
    enum: CampaignProgressLabel,
    nullable: true,
    name: 'campaign_progress_label',
  })
  campaignProgressLabel: CampaignProgressLabel | null;

  @Column({ type: 'text', nullable: true, name: 'pdf_document_url' })
  pdfDocumentUrl: string | null;

  @Column({ type: 'text', nullable: true, name: 'csv_document_url' })
  csvDocumentUrl: string | null;

  @Column({ type: 'uuid', name: 'requested_by_user_id' })
  requestedByUserId: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'requested_at' })
  requestedAt: Date;

  @Column({ type: 'timestamptz', nullable: true, name: 'resolved_at' })
  resolvedAt: Date | null;
}
