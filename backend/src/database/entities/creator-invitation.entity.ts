import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export enum CreatorInvitationStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  DECLINED = 'declined',
  EXPIRED = 'expired',
}

// US-23.2 / ADR-0055. Structurally mirrors E1's own workspace invitation
// (token-based, 7-day expiry, a status enum with the same four values)
// rather than inventing a new invitation pattern. Tracks one outreach
// attempt at a time -- a creator may have more than one invitation row over
// time, but status = accepted is terminal.
@Entity('creator_invitation')
export class CreatorInvitation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Nullable: a declined invitation's row survives its creator's hard
  // deletion (ADR-0055), at which point this column is set to null by the
  // database's own ON DELETE SET NULL behavior -- the declined invitation
  // itself is never deleted, only the creator and its public import are.
  @Column({ type: 'uuid', name: 'creator_id', nullable: true })
  creatorId: string | null;

  @Column({ type: 'text', unique: true })
  token: string;

  @Column({ type: 'text', name: 'contact_email' })
  contactEmail: string;

  @Column({ type: 'text', enum: CreatorInvitationStatus, default: CreatorInvitationStatus.PENDING })
  status: CreatorInvitationStatus;

  @Column({ type: 'timestamptz', name: 'expires_at' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true, name: 'responded_at' })
  respondedAt: Date | null;

  @Column({ type: 'uuid', name: 'created_by_user_id' })
  createdByUserId: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
