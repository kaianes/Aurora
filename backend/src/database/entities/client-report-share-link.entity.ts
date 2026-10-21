import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

// E9 / US-44, section 2.4 of the E9 architecture document (ADR-0061). Lives
// in the agency module, not analytics, for the same reason
// agency_branding_profile does: a white-label/agency-domain concern that
// happens to read a report analytics owns, not a reporting concern itself.
// One row per minted share link; a report can have more than one active
// link over its lifetime, so there is deliberately no uniqueness
// constraint on client_performance_report_id alone.
@Entity('client_report_share_link')
export class ClientReportShareLink {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'client_performance_report_id' })
  clientPerformanceReportId: string;

  @Column({ type: 'uuid', name: 'account_id' })
  accountId: string;

  @Column({ type: 'text' })
  token: string;

  @Column({ type: 'uuid', name: 'created_by_user_id' })
  createdByUserId: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @Column({ type: 'timestamptz', name: 'expires_at' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true, name: 'revoked_at' })
  revokedAt: Date | null;
}
