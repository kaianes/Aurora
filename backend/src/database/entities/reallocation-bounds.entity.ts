import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { Campaign } from './campaign.entity';

@Entity('reallocation_bounds')
export class ReallocationBounds {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', unique: true, name: 'campaign_id' })
  campaignId: string;

  @Column({ type: 'numeric', default: '20', name: 'max_shift_pct' })
  maxShiftPct: string;

  @Column({ type: 'numeric', default: '50', name: 'min_guaranteed_share_pct' })
  minGuaranteedSharePct: string;

  @Column({ type: 'boolean', default: false })
  enabled: boolean;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;

  @OneToOne(() => Campaign)
  @JoinColumn({ name: 'campaign_id' })
  campaign: Campaign;
}
