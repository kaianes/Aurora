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

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
