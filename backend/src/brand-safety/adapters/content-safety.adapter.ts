import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
import { InferenceService, InferenceUnavailableError } from '../../inference/inference.service';

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
  | { outcome: 'flagged'; tierReached: 'tier1'; triggers: EvaluateTrigger[] }
  | { outcome: 'flagged'; tierReached: 'tier2'; triggers: EvaluateTrigger[]; aiSafetyReason: string | null }
  // E10: check_unavailable is returned when Claude fails during tier-2 (section
  // 7.2 and 6.3 of the E10 architecture doc). The calling job maps this to
  // safety_check.status = 'check_unavailable'.
  | { outcome: 'check_unavailable'; tierReached: 'tier2' };

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
  private readonly logger = new Logger(RealContentSafetyAdapter.name);

  constructor(
    private inferenceService: InferenceService,
    private configService: ConfigService,
  ) {}

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

    // Tier-1 ambiguous: escalate to tier 2. E10 activates the real Claude
    // implementation (US-10.3, section 5.3 of the E10 architecture doc).
    return this.resolveTier2(ambiguousTriggers, input);
  }

  // Real Claude tier-2 implementation (E10, US-10.3). Replaces the stub.
  // The calling evaluate() method already has the full input; we pass input
  // and ambiguousTriggers so Claude can reason over the actual channel text
  // against the actual ruleset (section 5.3 of the E10 architecture doc).
  private async resolveTier2(
    ambiguousTriggers: EvaluateTrigger[],
    input: EvaluateInput,
  ): Promise<EvaluateResult> {
    // US-10.3 scenario 5: no ruleset means no tier-2 call needed.
    if (input.effectiveRuleset.length === 0) {
      return { outcome: 'pass', tierReached: 'tier2' };
    }

    const model = this.configService.get<string>('ANTHROPIC_MODEL_SAFETY', 'claude-sonnet-5');
    const timeoutMs = parseInt(
      this.configService.get<string>('AI_SAFETY_TIMEOUT_MS', '60000'),
      10,
    );

    const rulesBlock = input.effectiveRuleset
      .map((r) => {
        const summary = this.renderRuleDefinition(r.ruleType, r.definition);
        return `- Regra ${r.ruleId}: Tipo "${r.ruleType}", Definicao: ${summary}`;
      })
      .join('\n');

    const channelsBlock = [
      input.channels.caption
        ? `Canal "legenda": "${this.sanitizeField(input.channels.caption)}"`
        : null,
      input.channels.onScreenText
        ? `Canal "texto_na_tela": "${this.sanitizeField(input.channels.onScreenText)}"`
        : null,
      input.channels.audioTranscript
        ? `Canal "transcript_de_audio": "${this.sanitizeField(input.channels.audioTranscript)}"`
        : null,
    ]
      .filter(Boolean)
      .join('\n');

    const system = `Voce e um avaliador de seguranca de marca da plataforma Aurora. Sua tarefa e analisar semanticamente o conteudo submetido por um criador e determinar se ele viola as regras de seguranca de marca da campanha.

Instrucoes:
- Responda SEMPRE em Portugues Brasileiro.
- Analise o conteudo semanticamente. Uma violacao pode estar presente mesmo que nenhuma palavra exata da regra apareca no texto.
- Se houver violacao, identifique qual regra foi violada (cite o tipo e a definicao da regra) e em qual canal foi detectada (legenda, texto_na_tela ou transcript_de_audio).
- Se nao houver violacao semantica, retorne verdict "pass".
- Responda com um objeto JSON valido. Nada antes e nada depois do JSON.`;

    const user = `Regras de seguranca de marca desta campanha:
${rulesBlock}

Conteudo submetido para avaliacao:
${channelsBlock}

Avalie se o conteudo viola alguma das regras acima semanticamente.
Responda com JSON no seguinte formato exato, sem nenhum texto fora do JSON:
{
  "verdict": "pass",
  "reason": null
}
ou
{
  "verdict": "flagged",
  "reason": "Explicacao em Portugues Brasileiro de qual regra foi violada, em qual canal, e por que o conteudo semanticamente implica a violacao. Maximo 3 frases."
}`;

    let rawResponse: string;
    try {
      rawResponse = await this.inferenceService.completeText({
        model,
        maxTokens: 512,
        system,
        user,
        correlationId: `safety-tier2-${input.campaignId}`,
        timeoutMs,
      });
    } catch (error) {
      if (error instanceof InferenceUnavailableError) {
        return { outcome: 'check_unavailable', tierReached: 'tier2' };
      }
      return { outcome: 'check_unavailable', tierReached: 'tier2' };
    }

    // Parse Claude's JSON response. Invalid JSON is treated as check_unavailable
    // (section 6.3 of the E10 architecture doc).
    let parsed: { verdict: string; reason: string | null };
    try {
      // Strip any markdown code fences Claude might wrap around the JSON
      const cleaned = rawResponse.trim().replace(/^```json?\n?/, '').replace(/\n?```$/, '');
      parsed = JSON.parse(cleaned);
    } catch {
      this.logger.warn(
        `Tier-2 safety check for campaign ${input.campaignId}: Claude returned non-JSON response`,
      );
      return { outcome: 'check_unavailable', tierReached: 'tier2' };
    }

    if (parsed.verdict === 'pass') {
      return { outcome: 'pass', tierReached: 'tier2' };
    }

    if (parsed.verdict === 'flagged') {
      return {
        outcome: 'flagged',
        tierReached: 'tier2',
        triggers: ambiguousTriggers,
        aiSafetyReason: typeof parsed.reason === 'string' ? parsed.reason : null,
      };
    }

    // Unexpected verdict value: treat as check_unavailable
    this.logger.warn(
      `Tier-2 safety check for campaign ${input.campaignId}: unexpected verdict "${parsed.verdict}"`,
    );
    return { outcome: 'check_unavailable', tierReached: 'tier2' };
  }

  // Renders a rule definition to a one-line human-readable string for the
  // prompt (section 5.3 of the E10 architecture doc).
  private renderRuleDefinition(ruleType: SafetyRuleType, definition: SafetyRuleDefinition): string {
    switch (ruleType) {
      case SafetyRuleType.PROHIBITED_TOPIC: {
        const d = definition as ProhibitedTopicDefinition;
        return d.topic;
      }
      case SafetyRuleType.RESTRICTED_LANGUAGE: {
        const d = definition as RestrictedLanguageDefinition;
        return `padrao: ${d.pattern}`;
      }
      case SafetyRuleType.COMPETITOR_MENTION: {
        const d = definition as CompetitorMentionDefinition;
        return `concorrente: ${d.competitor_name}`;
      }
      default:
        return JSON.stringify(definition);
    }
  }

  // Strips bare backticks and angle brackets from creator-submitted content
  // before including in prompts (section 5 of the E10 architecture doc).
  private sanitizeField(value: string): string {
    return value.replace(/[`<>]/g, '');
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
