import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { SafetyRuleset } from './safety-ruleset.entity';

export enum SafetyRuleType {
  PROHIBITED_TOPIC = 'prohibited_topic',
  RESTRICTED_LANGUAGE = 'restricted_language',
  COMPETITOR_MENTION = 'competitor_mention',
}

export enum SafetyRuleAction {
  ADD = 'add',
  REPLACE = 'replace',
  SUPPRESS = 'suppress',
}

export interface ProhibitedTopicDefinition {
  topic: string;
}

export interface RestrictedLanguageDefinition {
  pattern: string;
  pattern_type: 'keyword' | 'regex';
}

export interface CompetitorMentionDefinition {
  competitor_name: string;
  aliases?: string[];
}

export type SafetyRuleDefinition =
  | ProhibitedTopicDefinition
  | RestrictedLanguageDefinition
  | CompetitorMentionDefinition;

// One row per rule (section 2.2 of the E4 architecture doc). Brand-scope
// rules always carry action = 'add' and supersedes_rule_id = null -- a brand
// ruleset has no concept of overriding itself. Campaign-scope rules use
// action/supersedes_rule_id for rule-level supersession (ADR-0019).
@Entity('safety_rule')
export class SafetyRule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'ruleset_id' })
  rulesetId: string;

  @Column({ type: 'text', enum: SafetyRuleType, name: 'rule_type' })
  ruleType: SafetyRuleType;

  // Null only when action = 'suppress' (chk_rule_definition_presence).
  @Column({ type: 'jsonb', nullable: true })
  definition: SafetyRuleDefinition | null;

  @Column({ type: 'text', enum: SafetyRuleAction, default: SafetyRuleAction.ADD })
  action: SafetyRuleAction;

  @Column({ type: 'uuid', nullable: true, name: 'supersedes_rule_id' })
  supersedesRuleId: string | null;

  @Column({ type: 'uuid', name: 'created_by_user_id' })
  createdByUserId: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => SafetyRuleset)
  @JoinColumn({ name: 'ruleset_id' })
  ruleset: SafetyRuleset;
}
