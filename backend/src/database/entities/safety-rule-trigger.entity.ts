import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { SafetyCheck, SafetyCheckTier } from './safety-check.entity';
import { SafetyRule } from './safety-rule.entity';

export enum SafetyTriggerChannel {
  CAPTION = 'caption',
  ON_SCREEN_TEXT = 'on_screen_text',
  AUDIO = 'audio',
  SYSTEM = 'system',
}

// One row per (rule, channel) combination that fired on a given check
// (section 2.2 of the E4 architecture doc). This is the structural mechanism
// behind US-16 scenario 2 and US-17 scenario 2: a check with violations in
// two channels, or two rules both triggering, produces multiple rows.
// channel = 'system' with rule_id = null is written exactly once when a
// check resolves to check_unavailable (ADR-0022).
@Entity('safety_rule_trigger')
export class SafetyRuleTrigger {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'safety_check_id' })
  safetyCheckId: string;

  @Column({ type: 'uuid', nullable: true, name: 'rule_id' })
  ruleId: string | null;

  @Column({ type: 'text', enum: SafetyTriggerChannel })
  channel: SafetyTriggerChannel;

  @Column({ type: 'text', nullable: true, name: 'matched_excerpt' })
  matchedExcerpt: string | null;

  @Column({ type: 'text', enum: SafetyCheckTier })
  tier: SafetyCheckTier;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => SafetyCheck)
  @JoinColumn({ name: 'safety_check_id' })
  safetyCheck: SafetyCheck;

  @ManyToOne(() => SafetyRule)
  @JoinColumn({ name: 'rule_id' })
  rule: SafetyRule | null;
}
