import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { Campaign } from './campaign.entity';

export enum ShortfallResolutionType {
  PARTIAL_REFUND = 'partial_refund',
  REVISED_GUARANTEE = 'revised_guarantee',
}

export enum ShortfallChosenBy {
  BUYER = 'buyer',
  AURORA_DEFAULT = 'aurora_default',
}

@Entity('pool_shortfall_resolution')
export class PoolShortfallResolution {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', unique: true, name: 'campaign_id' })
  campaignId: string;

  @Column({ type: 'text', enum: ShortfallResolutionType, name: 'resolution_type' })
  resolutionType: ShortfallResolutionType;

  @Column({ type: 'numeric', nullable: true, name: 'refund_amount' })
  refundAmount: string | null;

  @Column({ type: 'int', nullable: true, name: 'revised_min_pool_size' })
  revisedMinPoolSize: number | null;

  // Whether both options were actually offered to the buyer for this shortfall
  // (large shortfall, >= 15%) or only the default was auto-applied (small shortfall).
  @Column({ type: 'boolean', default: false, name: 'choice_offered' })
  choiceOffered: boolean;

  @Column({ type: 'text', name: 'chosen_by' })
  chosenBy: ShortfallChosenBy;

  @CreateDateColumn({ type: 'timestamptz', name: 'notified_at' })
  notifiedAt: Date;

  @Column({ type: 'timestamptz', nullable: true, name: 'resolved_at' })
  resolvedAt: Date | null;

  @OneToOne(() => Campaign)
  @JoinColumn({ name: 'campaign_id' })
  campaign: Campaign;
}
