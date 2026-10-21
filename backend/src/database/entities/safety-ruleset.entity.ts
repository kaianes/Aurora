import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Account } from './account.entity';
import { Campaign } from './campaign.entity';

export enum SafetyRulesetScope {
  BRAND = 'brand',
  CAMPAIGN = 'campaign',
}

// A scope = brand row is created lazily the first time an account saves any
// brand-level rule; a scope = campaign row is created lazily the first time a
// campaign-level override is saved (section 2.2 of the E4 architecture doc).
// A campaign with no override row has no row here at all -- its effective
// ruleset is the brand ruleset, unmodified (ADR-0019).
@Entity('safety_ruleset')
export class SafetyRuleset {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'account_id' })
  accountId: string;

  @Column({ type: 'text', enum: SafetyRulesetScope })
  scope: SafetyRulesetScope;

  @Column({ type: 'uuid', nullable: true, name: 'campaign_id' })
  campaignId: string | null;

  @Column({ type: 'uuid', name: 'created_by_user_id' })
  createdByUserId: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => Account)
  @JoinColumn({ name: 'account_id' })
  account: Account;

  @ManyToOne(() => Campaign)
  @JoinColumn({ name: 'campaign_id' })
  campaign: Campaign | null;
}
