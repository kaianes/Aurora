import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export enum DataSubjectRequestType {
  ACCESS = 'access',
  CORRECTION = 'correction',
  DELETION = 'deletion',
  PORTABILITY = 'portability',
}

export enum DataSubjectRequestStatus {
  PENDING = 'pending',
  FULFILLED = 'fulfilled',
}

// NFR-21 (beyond FR-13's claim-time scope) / ADR-0056. The minimal,
// ops-mediated mechanism closing the gap: an already-active creator's
// ongoing LGPD rights, tracked with an explicit 15-day due_at computed once
// at creation and never recalculated.
@Entity('creator_data_subject_request')
export class CreatorDataSubjectRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'creator_id' })
  creatorId: string;

  @Column({ type: 'text', enum: DataSubjectRequestType, name: 'request_type' })
  requestType: DataSubjectRequestType;

  @Column({ type: 'text', enum: DataSubjectRequestStatus, default: DataSubjectRequestStatus.PENDING })
  status: DataSubjectRequestStatus;

  @Column({ type: 'jsonb', nullable: true })
  details: Record<string, any> | null;

  @Column({ type: 'text', nullable: true, name: 'export_document_url' })
  exportDocumentUrl: string | null;

  @Column({ type: 'timestamptz', name: 'requested_at' })
  requestedAt: Date;

  @Column({ type: 'timestamptz', name: 'due_at' })
  dueAt: Date;

  @Column({ type: 'timestamptz', nullable: true, name: 'fulfilled_at' })
  fulfilledAt: Date | null;

  @Column({ type: 'uuid', nullable: true, name: 'fulfilled_by_user_id' })
  fulfilledByUserId: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
