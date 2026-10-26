import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Campaign } from './campaign.entity';
import { Creator } from './creator.entity';
import { CampaignOpportunity } from './campaign-opportunity.entity';

export enum PayoutObligationStatus {
  OWED = 'owed',
  IN_FLIGHT = 'in_flight',
  SETTLED = 'settled',
}

// The FR-44 entity (US-35a). Created exactly once per content_submission
// (unique constraint, section 3.6 of the E6 architecture doc) by
// PayoutObligationService.createForConfirmedPublication, called from E5's
// publication-confirmation flow (ADR-0036). payout_gross/commission/net are
// copied from campaign_opportunity at creation time and never recomputed
// (section 2.2 of the E6 architecture doc); committed_deadline_at is
// computed once from published_at + PAYOUT_WINDOW_DAYS (ADR-0034) and is
// itself immutable, trigger-enforced the same way E3's
// opportunity_payout_immutable trigger already works.
//
// Failure is deliberately not a fourth status (US-35c): a failed execution
// attempt leaves status = owed, with the failure fields below layered on
// top, never a terminal "failed" state.
@Entity('payout_obligation')
export class PayoutObligation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', unique: true, name: 'content_submission_id' })
  contentSubmissionId: string;

  @Column({ type: 'uuid', name: 'campaign_id' })
  campaignId: string;

  @Column({ type: 'uuid', name: 'creator_id' })
  creatorId: string;

  @Column({ type: 'uuid', name: 'opportunity_id' })
  opportunityId: string;

  @Column({ type: 'numeric', name: 'payout_gross' })
  payoutGross: string;

  @Column({ type: 'numeric', name: 'payout_commission' })
  payoutCommission: string;

  @Column({ type: 'numeric', name: 'payout_net' })
  payoutNet: string;

  @Column({ type: 'timestamptz', name: 'committed_deadline_at' })
  committedDeadlineAt: Date;

  @Column({ type: 'text', enum: PayoutObligationStatus, default: PayoutObligationStatus.OWED })
  status: PayoutObligationStatus;

  @Column({ type: 'timestamptz', nullable: true, name: 'in_flight_since' })
  inFlightSince: Date | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'settled_at' })
  settledAt: Date | null;

  @Column({ type: 'text', nullable: true, name: 'last_failure_reason' })
  lastFailureReason: string | null;

  // Set once, on the first detected failure, and never overwritten
  // afterward -- the anchor for US-35c's 24-hour notification clock.
  @Column({ type: 'timestamptz', nullable: true, name: 'first_failure_detected_at' })
  firstFailureDetectedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'last_failure_detected_at' })
  lastFailureDetectedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'failure_notification_sent_at' })
  failureNotificationSentAt: Date | null;

  // Mirrors ADR-0030's exact precedent: flips once, true, never un-set.
  @Column({ type: 'boolean', default: false, name: 'escalated_for_manual_review' })
  escalatedForManualReview: boolean;

  @Column({ type: 'timestamptz', nullable: true, name: 'escalated_at' })
  escalatedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => Campaign)
  @JoinColumn({ name: 'campaign_id' })
  campaign: Campaign;

  @ManyToOne(() => Creator)
  @JoinColumn({ name: 'creator_id' })
  creator: Creator;

  @ManyToOne(() => CampaignOpportunity)
  @JoinColumn({ name: 'opportunity_id' })
  opportunity: CampaignOpportunity;
}
