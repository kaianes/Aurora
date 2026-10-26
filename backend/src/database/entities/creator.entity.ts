import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum CreatorStatus {
  UNCLAIMED = 'unclaimed',
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
}

export enum CreatorOnboardingStatus {
  QUALIFIED = 'qualified',
  NOT_QUALIFIED = 'not_qualified',
  PENDING = 'pending',
}

export interface DemographicComposition {
  [key: string]: number;
}

// E8 additive extension (section 2.2 of the E8 architecture doc).
export enum CreatorRecruitmentOrigin {
  SELF_REGISTERED = 'self_registered',
  RECRUITED = 'recruited',
}

export enum CreatorAuthenticityStatus {
  PENDING = 'pending',
  SCORED = 'scored',
  INSUFFICIENT_DATA = 'insufficient_data',
}

// Minimal creator entity for E3 (ADR-0013). Owned long-term by E8, which will
// extend this table with social links, media kits, rate preferences, and the
// claim/unclaim lifecycle, not replace it. No account_id, no RLS: creators are
// shared reference data across tenants (section 2.4 of the E3 architecture doc).
@Entity('creator')
export class Creator {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', nullable: true, name: 'user_id' })
  userId: string | null;

  @Column({ type: 'text', name: 'display_name' })
  displayName: string;

  @Column({ type: 'text', enum: CreatorStatus, default: CreatorStatus.ACTIVE })
  status: CreatorStatus;

  @Column({
    type: 'text',
    enum: CreatorOnboardingStatus,
    default: CreatorOnboardingStatus.QUALIFIED,
    name: 'onboarding_status',
  })
  onboardingStatus: CreatorOnboardingStatus;

  @Column({ type: 'text', nullable: true, name: 'content_niche' })
  contentNiche: string | null;

  @Column({ type: 'jsonb', nullable: true, name: 'demographic_composition' })
  demographicComposition: DemographicComposition | null;

  @Column({ type: 'int', nullable: true, name: 'audience_size' })
  audienceSize: number | null;

  @Column({ type: 'numeric', nullable: true, name: 'engagement_rate' })
  engagementRate: string | null;

  @Column({ type: 'numeric', nullable: true, name: 'authenticity_score' })
  authenticityScore: string | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'metrics_computed_at' })
  metricsComputedAt: Date | null;

  @Column({ type: 'boolean', default: false, name: 'metrics_stale' })
  metricsStale: boolean;

  // Completion rate of past opportunities (accepted-and-published / accepted),
  // used by the matching engine's historical_reliability signal (ADR-0011).
  // Null until the creator has a track record; the scorer defaults to 0.5.
  @Column({ type: 'numeric', nullable: true, name: 'historical_reliability' })
  historicalReliability: string | null;

  // E6 additive extension (ADR-0013's "extend, not replace" precedent):
  // US-36b's tax-documentation fields. Nullable, no backfill required, no
  // existing row or code path that reads creator needs to change. No
  // validation beyond presence is performed at the pilot stage (ADR-0041).
  @Column({ type: 'text', nullable: true, name: 'tax_id' })
  taxId: string | null;

  @Column({ type: 'text', nullable: true, name: 'tax_id_type' })
  taxIdType: string | null; // 'cpf' | 'cnpj'

  // E8 additive extension (section 2.2 of the E8 architecture doc, ADR-0054,
  // ADR-0052, ADR-0053). No existing column is removed, renamed, or
  // retyped; no existing E3 query changes shape (section 11).
  @Column({
    type: 'text',
    enum: CreatorRecruitmentOrigin,
    default: CreatorRecruitmentOrigin.SELF_REGISTERED,
    name: 'recruitment_origin',
  })
  recruitmentOrigin: CreatorRecruitmentOrigin;

  // Set only while status = unclaimed (chk_unclaimed_expiry_consistency).
  @Column({ type: 'timestamptz', nullable: true, name: 'unclaimed_expires_at' })
  unclaimedExpiresAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'claimed_at' })
  claimedAt: Date | null;

  @Column({
    type: 'text',
    enum: CreatorAuthenticityStatus,
    default: CreatorAuthenticityStatus.PENDING,
    name: 'authenticity_status',
  })
  authenticityStatus: CreatorAuthenticityStatus;

  @Column({ type: 'timestamptz', nullable: true, name: 'authenticity_computed_at' })
  authenticityComputedAt: Date | null;

  @Column({ type: 'jsonb', nullable: true, name: 'qualification_missing_criteria' })
  qualificationMissingCriteria: string[] | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'qualification_decided_at' })
  qualificationDecidedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'qualification_expected_ready_at' })
  qualificationExpectedReadyAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'qualification_notified_at' })
  qualificationNotifiedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
