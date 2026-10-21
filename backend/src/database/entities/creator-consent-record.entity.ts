import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export enum CreatorConsentType {
  TERMS_ACCEPTANCE = 'terms_acceptance',
  OAUTH_AUTHORIZATION = 'oauth_authorization',
  PROFILE_CLAIM = 'profile_claim',
}

// NFR-22: one row per consent-bearing event this epic has (registration,
// claim confirmation, every successful OAuth callback). Scoped to
// creator-subject consent only; it does not generalize to brand/agency user
// consent (section 2.2 of the E8 architecture doc).
@Entity('creator_consent_record')
export class CreatorConsentRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'creator_id' })
  creatorId: string;

  @Column({ type: 'text', enum: CreatorConsentType, name: 'consent_type' })
  consentType: CreatorConsentType;

  @Column({ type: 'jsonb', nullable: true })
  scope: string[] | null;

  @Column({ type: 'text', nullable: true, name: 'terms_version' })
  termsVersion: string | null;

  @Column({ type: 'timestamptz', name: 'granted_at' })
  grantedAt: Date;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
