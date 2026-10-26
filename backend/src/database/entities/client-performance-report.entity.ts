import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';
import { PerformanceReportStatus } from './campaign-performance-report.entity';

// US-43 / FR-55's per-client export entity (section 2.2 of the E7
// architecture doc). account_id is the client's own account, not the
// agency's home account, so the standard account_id-keyed RLS policy
// applies with no special workspace-level policy needed.
@Entity('client_performance_report')
export class ClientPerformanceReport {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'account_id' })
  accountId: string;

  @Column({ type: 'text', enum: PerformanceReportStatus, default: PerformanceReportStatus.PENDING })
  status: PerformanceReportStatus;

  @Column({ type: 'int', nullable: true, name: 'campaign_count' })
  campaignCount: number | null;

  @Column({ type: 'numeric', nullable: true, name: 'total_spend' })
  totalSpend: string | null;

  @Column({ type: 'int', nullable: true, name: 'total_delivered_reach' })
  totalDeliveredReach: number | null;

  @Column({ type: 'int', nullable: true, name: 'total_delivered_engagement' })
  totalDeliveredEngagement: number | null;

  @Column({ type: 'numeric', nullable: true, name: 'cost_per_engagement' })
  costPerEngagement: string | null;

  @Column({ type: 'numeric', nullable: true, name: 'cpm_equivalent' })
  cpmEquivalent: string | null;

  @Column({ type: 'boolean', nullable: true, name: 'branding_applied' })
  brandingApplied: boolean | null;

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
