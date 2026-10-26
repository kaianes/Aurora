import { describe, it, expect } from 'vitest';
import { RealContentSafetyAdapter } from './content-safety.adapter';
import { SafetyRuleType } from '../../database/entities';

describe('RealContentSafetyAdapter - US-16', () => {
  const adapter = new RealContentSafetyAdapter();

  // US-16 scenario 1: a compliant submission passes.
  it('passes a submission with no rule violations in any channel', async () => {
    const result = await adapter.evaluate({
      campaignId: 'camp-1',
      effectiveRuleset: [
        {
          ruleId: 'rule-competitor',
          ruleType: SafetyRuleType.COMPETITOR_MENTION,
          definition: { competitor_name: 'Marca Rival Ltda', aliases: ['Rival'] },
        },
      ],
      channels: {
        caption: 'Esse serum mudou minha pele em 14 dias!',
        onScreenText: 'RESULTADOS EM 14 DIAS',
        audioTranscript: null,
      },
    });

    expect(result.outcome).toBe('pass');
    expect(result.tierReached).toBe('tier1');
  });

  // US-16 scenario 2: a violation surfaces in only one of the three checked
  // channels (audio), while caption and on-screen text are both clean. A
  // pass in two of three channels must never produce an overall pass.
  it('flags a submission whose violation appears only in the audio channel', async () => {
    const result = await adapter.evaluate({
      campaignId: 'camp-1',
      effectiveRuleset: [
        {
          ruleId: 'rule-restricted-language',
          ruleType: SafetyRuleType.RESTRICTED_LANGUAGE,
          definition: { pattern: 'resultado garantido', pattern_type: 'keyword' },
        },
      ],
      channels: {
        caption: 'Esse serum mudou minha pele em 14 dias!',
        onScreenText: 'RESULTADOS EM 14 DIAS',
        audioTranscript: 'Voce vai ter resultado garantido em uma semana',
      },
    });

    expect(result.outcome).toBe('flagged');
    if (result.outcome === 'flagged') {
      expect(result.triggers).toHaveLength(1);
      expect(result.triggers[0]).toMatchObject({
        ruleId: 'rule-restricted-language',
        channel: 'audio',
      });
    }
  });

  // US-16 scenario 2 / US-17 scenario 2: a submission triggering more than
  // one rule across channels lists every rule triggered, not just the first.
  it('lists every rule triggered when multiple rules fire across multiple channels', async () => {
    const result = await adapter.evaluate({
      campaignId: 'camp-1',
      effectiveRuleset: [
        {
          ruleId: 'rule-restricted-language',
          ruleType: SafetyRuleType.RESTRICTED_LANGUAGE,
          definition: { pattern: 'resultado garantido', pattern_type: 'keyword' },
        },
        {
          ruleId: 'rule-prohibited-topic',
          ruleType: SafetyRuleType.PROHIBITED_TOPIC,
          definition: { topic: 'testes em animais' },
        },
      ],
      channels: {
        caption: 'Produto sem testes em animais, resultado garantido',
        onScreenText: null,
        audioTranscript: null,
      },
    });

    expect(result.outcome).toBe('flagged');
    if (result.outcome === 'flagged') {
      const ruleIds = result.triggers.map((t) => t.ruleId);
      expect(ruleIds).toContain('rule-restricted-language');
      expect(ruleIds).toContain('rule-prohibited-topic');
      expect(result.triggers.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('matches a competitor_mention rule via an alias', async () => {
    const result = await adapter.evaluate({
      campaignId: 'camp-1',
      effectiveRuleset: [
        {
          ruleId: 'rule-competitor',
          ruleType: SafetyRuleType.COMPETITOR_MENTION,
          definition: { competitor_name: 'Marca Rival Ltda', aliases: ['Rival', '@marcarival'] },
        },
      ],
      channels: { caption: 'Melhor que a @marcarival!', onScreenText: null, audioTranscript: null },
    });

    expect(result.outcome).toBe('flagged');
  });

  it('escalates an ambiguous (partial-overlap) prohibited_topic signal to tier 2', async () => {
    const result = await adapter.evaluate({
      campaignId: 'camp-1',
      effectiveRuleset: [
        {
          ruleId: 'rule-prohibited-topic',
          ruleType: SafetyRuleType.PROHIBITED_TOPIC,
          // 4 significant words; only 2 appear in the text below (50% overlap),
          // enough to be ambiguous (tier 2) but not a clear tier-1 violation.
          definition: { topic: 'promocao enganosa de desconto abusivo' },
        },
      ],
      channels: { caption: 'Desconto abusivo nunca foi nossa politica', onScreenText: null, audioTranscript: null },
    });

    expect(result.tierReached).toBe('tier2');
  });

  it('rejects an unmatched regex pattern cleanly without throwing', async () => {
    const result = await adapter.evaluate({
      campaignId: 'camp-1',
      effectiveRuleset: [
        {
          ruleId: 'rule-restricted-language',
          ruleType: SafetyRuleType.RESTRICTED_LANGUAGE,
          definition: { pattern: 'cura[0-9]+garantida', pattern_type: 'regex' },
        },
      ],
      channels: { caption: 'Nada relacionado aqui', onScreenText: null, audioTranscript: null },
    });

    expect(result.outcome).toBe('pass');
  });
});
