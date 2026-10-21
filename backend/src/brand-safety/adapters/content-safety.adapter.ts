import { Injectable } from '@nestjs/common';
import {
  SafetyRuleType,
  SafetyRuleDefinition,
  ProhibitedTopicDefinition,
  RestrictedLanguageDefinition,
  CompetitorMentionDefinition,
} from '../../database/entities';
import {
  TIER1_PROHIBITED_TOPIC_FULL_OVERLAP,
  TIER2_PROHIBITED_TOPIC_PARTIAL_OVERLAP,
} from '../brand-safety.config';

// Resolved per ADR-0019 (already merged brand + campaign-override rules),
// the shape the run-safety-check job hands to the adapter.
export interface EffectiveRule {
  ruleId: string;
  ruleType: SafetyRuleType;
  definition: SafetyRuleDefinition;
}

export type EvaluateChannel = 'caption' | 'on_screen_text' | 'audio';

export interface EvaluateInput {
  campaignId: string;
  effectiveRuleset: EffectiveRule[];
  channels: {
    caption: string;
    onScreenText: string | null;
    audioTranscript: string | null;
  };
}

export interface EvaluateTrigger {
  ruleId: string;
  channel: EvaluateChannel;
  matchedExcerpt: string;
}

export type EvaluateResult =
  | { outcome: 'pass'; tierReached: 'tier1' | 'tier2' }
  | { outcome: 'flagged'; tierReached: 'tier1' | 'tier2'; triggers: EvaluateTrigger[] };

// ADR-0021: the only interface the run-safety-check job depends on for
// judgment. Never writes to any database table itself -- it returns a
// judgment, the calling job persists safety_check/safety_rule_trigger/
// safety_review_queue_item rows. This keeps the adapter a pure function of
// its input, which is what makes it safely swappable (NFR-29).
export interface ContentSafetyAdapter {
  evaluate(input: EvaluateInput): Promise<EvaluateResult>;
}

export const CONTENT_SAFETY_ADAPTER = 'CONTENT_SAFETY_ADAPTER';

interface RuleMatch {
  level: 'exact' | 'partial';
  matchedExcerpt: string;
}

// Implements the two-tier cascade `docs/architecture.md` QAS-02 specifies
// (tier-1 screen, tier-2 escalation on ambiguity) behind the adapter
// boundary, with a deterministic rule-matching tier 1 (no real ML/LLM
// backend exists yet) and a stub tier 2 that resolves tier-1's ambiguous
// signals with a lower confidence bar. Both tiers live in this one class,
// consistent with ADR-0021's framing of "the cascade" as the adapter's
// internal behavior, not two separate adapters -- swapping either tier for
// a real model later is a change inside this class and its DI binding only.
@Injectable()
export class RealContentSafetyAdapter implements ContentSafetyAdapter {
  async evaluate(input: EvaluateInput): Promise<EvaluateResult> {
    const channels: Array<{ name: EvaluateChannel; text: string | null }> = [
      { name: 'caption', text: input.channels.caption },
      { name: 'on_screen_text', text: input.channels.onScreenText },
      { name: 'audio', text: input.channels.audioTranscript },
    ];

    const exactTriggers: EvaluateTrigger[] = [];
    const ambiguousTriggers: EvaluateTrigger[] = [];

    for (const rule of input.effectiveRuleset) {
      for (const channel of channels) {
        if (!channel.text) continue;
        const match = this.matchRule(rule, channel.text);
        if (!match) continue;
        const trigger: EvaluateTrigger = {
          ruleId: rule.ruleId,
          channel: channel.name,
          matchedExcerpt: match.matchedExcerpt,
        };
        if (match.level === 'exact') {
          exactTriggers.push(trigger);
        } else {
          ambiguousTriggers.push(trigger);
        }
      }
    }

    // Tier-1 clear violation: at least one exact match resolves the check
    // immediately, no escalation needed (section 2.7's state machine).
    if (exactTriggers.length > 0) {
      return { outcome: 'flagged', tierReached: 'tier1', triggers: exactTriggers };
    }

    // Tier-1 clear pass: nothing exact and nothing ambiguous either.
    if (ambiguousTriggers.length === 0) {
      return { outcome: 'pass', tierReached: 'tier1' };
    }

    // Tier-1 ambiguous: escalate to tier 2 (stub -- swappable for a real
    // reasoning model later without touching this method's signature or any
    // caller, per ADR-0021). The stub resolves ambiguity with a lower
    // confidence bar than tier 1's exact-match requirement.
    return this.resolveTier2(ambiguousTriggers);
  }

  private resolveTier2(ambiguousTriggers: EvaluateTrigger[]): EvaluateResult {
    // Placeholder tier-2 judgment: every tier-1-ambiguous signal that
    // reached here already cleared TIER2_PROHIBITED_TOPIC_PARTIAL_OVERLAP at
    // matching time (see matchProhibitedTopic), so tier 2 confirms them as
    // triggers. A real tier-2 model would re-reason over the full channel
    // text instead of trusting the tier-1 signal verbatim.
    if (ambiguousTriggers.length === 0) {
      return { outcome: 'pass', tierReached: 'tier2' };
    }
    return { outcome: 'flagged', tierReached: 'tier2', triggers: ambiguousTriggers };
  }

  private matchRule(rule: EffectiveRule, text: string): RuleMatch | null {
    switch (rule.ruleType) {
      case SafetyRuleType.RESTRICTED_LANGUAGE:
        return this.matchRestrictedLanguage(rule.definition as RestrictedLanguageDefinition, text);
      case SafetyRuleType.COMPETITOR_MENTION:
        return this.matchCompetitorMention(rule.definition as CompetitorMentionDefinition, text);
      case SafetyRuleType.PROHIBITED_TOPIC:
        return this.matchProhibitedTopic(rule.definition as ProhibitedTopicDefinition, text);
      default:
        return null;
    }
  }

  // Deterministic, exact-or-nothing: a restricted-language rule is either
  // matched by its (pre-validated, section 2.3) pattern or it is not.
  private matchRestrictedLanguage(
    definition: RestrictedLanguageDefinition,
    text: string,
  ): RuleMatch | null {
    if (definition.pattern_type === 'regex') {
      try {
        const regex = new RegExp(definition.pattern, 'i');
        const match = regex.exec(text);
        if (match) return { level: 'exact', matchedExcerpt: match[0] };
      } catch {
        // Pattern was validated at save time; a runtime failure here is
        // treated as no match rather than throwing out of the cascade.
        return null;
      }
      return null;
    }

    // keyword: '|'-separated literal alternatives, case-insensitive substring.
    const alternatives = definition.pattern.split('|').map((a) => a.trim()).filter(Boolean);
    for (const alt of alternatives) {
      const excerpt = this.findSubstring(text, alt);
      if (excerpt) return { level: 'exact', matchedExcerpt: excerpt };
    }
    return null;
  }

  private matchCompetitorMention(
    definition: CompetitorMentionDefinition,
    text: string,
  ): RuleMatch | null {
    const candidates = [definition.competitor_name, ...(definition.aliases || [])];
    for (const candidate of candidates) {
      const excerpt = this.findSubstring(text, candidate);
      if (excerpt) return { level: 'exact', matchedExcerpt: excerpt };
    }
    return null;
  }

  // No single contiguous phrase match is expected for free-text topics
  // (e.g. "testes em animais" rarely appears verbatim) -- this is a
  // significant-word-overlap heuristic standing in for real topic
  // classification until a real tier-1/tier-2 model replaces it (ADR-0021).
  private matchProhibitedTopic(
    definition: ProhibitedTopicDefinition,
    text: string,
  ): RuleMatch | null {
    const topic = definition.topic;
    const lowerText = text.toLowerCase();

    if (lowerText.includes(topic.toLowerCase())) {
      return { level: 'exact', matchedExcerpt: topic };
    }

    const words = topic
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length >= 4);
    const significantWords = words.length > 0 ? words : topic.toLowerCase().split(/\s+/).filter(Boolean);
    if (significantWords.length === 0) return null;

    const matchedCount = significantWords.filter((w) => lowerText.includes(w)).length;
    const ratio = matchedCount / significantWords.length;

    if (ratio >= TIER1_PROHIBITED_TOPIC_FULL_OVERLAP) {
      return { level: 'exact', matchedExcerpt: topic };
    }
    if (ratio >= TIER2_PROHIBITED_TOPIC_PARTIAL_OVERLAP) {
      return { level: 'partial', matchedExcerpt: topic };
    }
    return null;
  }

  private findSubstring(text: string, needle: string): string | null {
    if (!needle) return null;
    const index = text.toLowerCase().indexOf(needle.toLowerCase());
    if (index === -1) return null;
    return text.slice(index, index + needle.length);
  }
}
