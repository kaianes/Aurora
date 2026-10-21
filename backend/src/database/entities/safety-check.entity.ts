import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { ContentSubmission } from './content-submission.entity';
import { Campaign } from './campaign.entity';
import { SafetyRuleset } from './safety-ruleset.entity';

export enum SafetyCheckStatus {
  PENDING = 'pending',
  PASSED = 'passed',
  FLAGGED = 'flagged',
  CHECK_UNAVAILABLE = 'check_unavailable',
}

export enum SafetyCheckTier {
  TIER1 = 'tier1',
  TIER2 = 'tier2',
}

// One row per check attempt (section 2.2 of the E4 architecture doc). A
// submission can be rechecked, so this is not unique per submission. Each of
// passed/flagged/check_unavailable is terminal for this row; a recheck is a
// new row, never a reopened one (section 2.7, state machine).
@Entity('safety_check')
export class SafetyCheck {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'content_submission_id' })
  contentSubmissionId: string;

  // Denormalized for RLS join performance (section 2.5 of the E4 architecture doc).
  @Column({ type: 'uuid', name: 'campaign_id' })
  campaignId: string;

  // Which ruleset (brand, or the campaign's override ruleset if one exists)
  // governed this check -- bookkeeping only, not a full rule-content
  // snapshot (PRD open question 2 is explicitly left unresolved). Nullable:
  // a campaign with no brand ruleset ever saved and no override has no
  // ruleset row to reference at all.
  @Column({ type: 'uuid', nullable: true, name: 'ruleset_id' })
  rulesetId: string | null;

  @Column({ type: 'text', enum: SafetyCheckStatus, default: SafetyCheckStatus.PENDING })
  status: SafetyCheckStatus;

  @Column({ type: 'text', enum: SafetyCheckTier, nullable: true, name: 'tier_reached' })
  tierReached: SafetyCheckTier | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'requested_at' })
  requestedAt: Date;

  @Column({ type: 'timestamptz', name: 'timeout_at' })
  timeoutAt: Date;

  @Column({ type: 'timestamptz', nullable: true, name: 'resolved_at' })
  resolvedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => ContentSubmission)
  @JoinColumn({ name: 'content_submission_id' })
  contentSubmission: ContentSubmission;

  @ManyToOne(() => Campaign)
  @JoinColumn({ name: 'campaign_id' })
  campaign: Campaign;

  @ManyToOne(() => SafetyRuleset)
  @JoinColumn({ name: 'ruleset_id' })
  ruleset: SafetyRuleset | null;
}
