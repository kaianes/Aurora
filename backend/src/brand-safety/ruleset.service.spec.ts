import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { RulesetService } from './ruleset.service';
import { SafetyRuleAction, SafetyRulesetScope, SafetyRuleType } from '../database/entities';

const mockRepo = () => ({
  findOne: vi.fn(),
  find: vi.fn().mockResolvedValue([]),
  create: vi.fn((data: any) => ({ ...data })),
  save: vi.fn((entity: any) =>
    Promise.resolve({ id: entity.id || 'id-' + Math.random(), createdAt: new Date(), ...entity }),
  ),
  remove: vi.fn(),
  createQueryBuilder: vi.fn(),
});

function mockQueryRunner() {
  const manager = {
    create: vi.fn((_entity: any, data: any) => ({ ...data })),
    save: vi.fn((entity: any) =>
      Array.isArray(entity)
        ? Promise.resolve(
            entity.map((e) => ({ id: e.id || 'id-' + Math.random(), createdAt: new Date(), ...e })),
          )
        : Promise.resolve({ id: entity.id || 'id-' + Math.random(), createdAt: new Date(), ...entity }),
    ),
    delete: vi.fn().mockResolvedValue({ affected: 0 }),
  };
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    startTransaction: vi.fn().mockResolvedValue(undefined),
    commitTransaction: vi.fn().mockResolvedValue(undefined),
    rollbackTransaction: vi.fn().mockResolvedValue(undefined),
    release: vi.fn().mockResolvedValue(undefined),
    manager,
  };
}

describe('RulesetService - US-15', () => {
  let service: RulesetService;
  let rulesetRepo: ReturnType<typeof mockRepo>;
  let ruleRepo: ReturnType<typeof mockRepo>;
  let campaignRepo: ReturnType<typeof mockRepo>;
  let auditService: { log: ReturnType<typeof vi.fn> };
  let dataSource: { createQueryRunner: ReturnType<typeof vi.fn> };
  let queryRunner: ReturnType<typeof mockQueryRunner>;

  const actor = { userId: 'user-1', ipAddress: '127.0.0.1', userAgent: 'vitest' };

  beforeEach(() => {
    rulesetRepo = mockRepo();
    ruleRepo = mockRepo();
    campaignRepo = mockRepo();
    auditService = { log: vi.fn().mockResolvedValue(undefined) };
    queryRunner = mockQueryRunner();
    dataSource = { createQueryRunner: vi.fn(() => queryRunner) };

    service = new RulesetService(
      rulesetRepo as any,
      ruleRepo as any,
      campaignRepo as any,
      auditService as any,
      dataSource as any,
    );
  });

  // US-15 scenario 1: brand ruleset conceptually always exists.
  it('returns an empty rule list, not a 404, when no brand ruleset has ever been saved', async () => {
    rulesetRepo.findOne.mockResolvedValue(undefined);
    const result = await service.getBrandRuleset('account-1');
    expect(result.rules).toEqual([]);
    expect(result.id).toBeNull();
  });

  it('lazily creates the brand ruleset on first rule save', async () => {
    rulesetRepo.findOne.mockResolvedValue(undefined);
    const result = await service.createBrandRule(
      'account-1',
      { rule_type: 'prohibited_topic', definition: { topic: 'testes em animais' } },
      actor,
    );
    expect(rulesetRepo.save).toHaveBeenCalled();
    expect(result.rule_type).toBe('prohibited_topic');
    expect(auditService.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'safety_rule.created' }));
  });

  // US-15 scenario 3: a restricted-language pattern it cannot parse is rejected.
  it('rejects an unparseable regex restricted_language rule with RULE_PATTERN_INVALID', async () => {
    rulesetRepo.findOne.mockResolvedValue({ id: 'ruleset-1' });
    await expect(
      service.createBrandRule(
        'account-1',
        {
          rule_type: 'restricted_language',
          definition: { pattern: '(unterminated[', pattern_type: 'regex' },
        },
        actor,
      ),
    ).rejects.toMatchObject({
      response: { error: { code: 'RULE_PATTERN_INVALID' } },
    });
    expect(ruleRepo.save).not.toHaveBeenCalled();
  });

  // US-15 scenario 3: a competitor reference it cannot resolve is rejected.
  it('rejects a purely numeric/symbolic competitor_mention rule with RULE_COMPETITOR_UNRESOLVED', async () => {
    rulesetRepo.findOne.mockResolvedValue({ id: 'ruleset-1' });
    await expect(
      service.createBrandRule(
        'account-1',
        { rule_type: 'competitor_mention', definition: { competitor_name: '12345' } },
        actor,
      ),
    ).rejects.toMatchObject({
      response: { error: { code: 'RULE_COMPETITOR_UNRESOLVED' } },
    });
    expect(ruleRepo.save).not.toHaveBeenCalled();
  });

  it('rejects a too-short prohibited_topic rule with RULE_TOPIC_INVALID', async () => {
    rulesetRepo.findOne.mockResolvedValue({ id: 'ruleset-1' });
    await expect(
      service.createBrandRule('account-1', { rule_type: 'prohibited_topic', definition: { topic: 'a' } }, actor),
    ).rejects.toMatchObject({
      response: { error: { code: 'RULE_TOPIC_INVALID' } },
    });
  });

  // Section 3.2 of the E4 architecture doc: PATCH re-validates the merged
  // definition -- fields not supplied in the request are preserved, not
  // dropped by a wholesale replace.
  it('merges a partial PATCH onto the existing definition rather than replacing it wholesale', async () => {
    rulesetRepo.findOne.mockResolvedValue({ id: 'ruleset-1' });
    ruleRepo.findOne.mockResolvedValue({
      id: 'rule-1',
      rulesetId: 'ruleset-1',
      ruleType: SafetyRuleType.COMPETITOR_MENTION,
      definition: { competitor_name: 'Marca Rival Ltda', aliases: ['Rival'] },
    });

    const result = await service.updateBrandRule(
      'account-1',
      'rule-1',
      { definition: { competitor_name: 'Marca Rival S.A.' } },
      actor,
    );

    expect(result.definition).toEqual({ competitor_name: 'Marca Rival S.A.', aliases: ['Rival'] });
  });

  // US-15 scenario 3: on a PATCH failure, the rule is left exactly as it was.
  it('leaves the rule unchanged when an update fails validation', async () => {
    const existingRule = {
      id: 'rule-1',
      rulesetId: 'ruleset-1',
      ruleType: SafetyRuleType.COMPETITOR_MENTION,
      definition: { competitor_name: 'Marca Rival' },
    };
    rulesetRepo.findOne.mockResolvedValue({ id: 'ruleset-1' });
    ruleRepo.findOne.mockResolvedValue({ ...existingRule });

    await expect(
      service.updateBrandRule('account-1', 'rule-1', { definition: { competitor_name: '!!!' } }, actor),
    ).rejects.toMatchObject({
      response: { error: { code: 'RULE_COMPETITOR_UNRESOLVED' } },
    });
    expect(ruleRepo.save).not.toHaveBeenCalled();
  });

  // US-15 scenario 3: the bulk endpoint never commits a partially invalid batch.
  it('rejects the entire bulk batch and commits nothing when one create item is invalid', async () => {
    rulesetRepo.findOne.mockResolvedValue(undefined);

    await expect(
      service.bulkBrandRules(
        'account-1',
        {
          create: [
            { rule_type: 'prohibited_topic', definition: { topic: 'ingredientes sinteticos' } },
            { rule_type: 'restricted_language', definition: { pattern: '', pattern_type: 'keyword' } },
          ],
        },
        actor,
      ),
    ).rejects.toMatchObject({
      response: { error: { code: 'RULE_PATTERN_INVALID', details: { failing_item: { type: 'create', index: 1 } } } },
    });

    // No transaction was ever opened -- validation happens before any write.
    expect(dataSource.createQueryRunner).not.toHaveBeenCalled();
  });

  it('commits a valid bulk batch atomically', async () => {
    rulesetRepo.findOne.mockResolvedValue({ id: 'ruleset-1' });
    ruleRepo.find.mockResolvedValue([
      { id: 'rule-1', ruleType: SafetyRuleType.PROHIBITED_TOPIC, definition: { topic: 'old topic value' } },
    ]);

    const result = await service.bulkBrandRules(
      'account-1',
      {
        create: [{ rule_type: 'prohibited_topic', definition: { topic: 'novo topico valido' } }],
        update: [{ id: 'rule-1', definition: { topic: 'topico atualizado' } }],
      },
      actor,
    );

    expect(queryRunner.commitTransaction).toHaveBeenCalled();
    expect(result.created).toHaveLength(1);
    expect(result.updated).toHaveLength(1);
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'safety_rules.bulk_updated' }),
    );
  });

  // US-15 scenario 2: a campaign-level suppress override leaves the brand
  // default and every other campaign untouched, and is clearly marked.
  describe('campaign effective ruleset (ADR-0019)', () => {
    beforeEach(() => {
      campaignRepo.findOne.mockResolvedValue({ id: 'camp-1', accountId: 'account-1' });
    });

    it('marks a suppress override clearly and excludes the superseded brand rule from the effective set', async () => {
      const brandRuleset = { id: 'brand-ruleset-1' };
      const campaignRuleset = { id: 'campaign-ruleset-1' };
      rulesetRepo.findOne.mockImplementation(({ where }: any) => {
        if (where.scope === SafetyRulesetScope.BRAND) return Promise.resolve(brandRuleset);
        if (where.scope === SafetyRulesetScope.CAMPAIGN) return Promise.resolve(campaignRuleset);
        return Promise.resolve(undefined);
      });
      ruleRepo.find.mockImplementation(({ where }: any) => {
        if (where.rulesetId === 'brand-ruleset-1') {
          return Promise.resolve([
            { id: 'rule-003', ruleType: SafetyRuleType.COMPETITOR_MENTION, definition: { competitor_name: 'Rival' } },
            { id: 'rule-001', ruleType: SafetyRuleType.PROHIBITED_TOPIC, definition: { topic: 'teste' } },
          ]);
        }
        if (where.rulesetId === 'campaign-ruleset-1') {
          return Promise.resolve([
            {
              id: 'rule-override-010',
              ruleType: SafetyRuleType.COMPETITOR_MENTION,
              definition: null,
              action: SafetyRuleAction.SUPPRESS,
              supersedesRuleId: 'rule-003',
            },
          ]);
        }
        return Promise.resolve([]);
      });

      const result = await service.getEffectiveCampaignRuleset('camp-1', 'account-1');

      expect(result.has_override).toBe(true);
      expect(result.override_rule_ids).toEqual(['rule-override-010']);
      const ruleIds = result.effective_rules.map((r) => r.id);
      expect(ruleIds).not.toContain('rule-003');
      expect(ruleIds).toContain('rule-001');
      expect(ruleIds).toContain('rule-override-010');
    });

    it('reports has_override false and the unmodified brand ruleset when no override exists', async () => {
      rulesetRepo.findOne.mockImplementation(({ where }: any) => {
        if (where.scope === SafetyRulesetScope.BRAND) return Promise.resolve({ id: 'brand-ruleset-1' });
        return Promise.resolve(undefined);
      });
      ruleRepo.find.mockResolvedValue([
        { id: 'rule-001', ruleType: SafetyRuleType.PROHIBITED_TOPIC, definition: { topic: 'teste' } },
      ]);

      const result = await service.getEffectiveCampaignRuleset('camp-1', 'account-1');
      expect(result.has_override).toBe(false);
      expect(result.override_rule_ids).toEqual([]);
    });

    it('rejects a supersedes_rule_id that does not belong to this account brand ruleset', async () => {
      rulesetRepo.findOne.mockImplementation(({ where }: any) => {
        if (where.scope === SafetyRulesetScope.BRAND) return Promise.resolve({ id: 'brand-ruleset-1' });
        return Promise.resolve(undefined);
      });
      ruleRepo.findOne.mockResolvedValue(undefined);

      await expect(
        service.createCampaignOverride(
          'camp-1',
          'account-1',
          { action: 'suppress', supersedes_rule_id: 'rule-from-another-account' },
          actor,
        ),
      ).rejects.toMatchObject({
        response: { error: { code: 'INVALID_SUPERSEDES_REFERENCE' } },
      });
    });

    it('derives rule_type from the superseded rule for a suppress override', async () => {
      rulesetRepo.findOne.mockImplementation(({ where }: any) => {
        if (where.scope === SafetyRulesetScope.BRAND) return Promise.resolve({ id: 'brand-ruleset-1' });
        if (where.scope === SafetyRulesetScope.CAMPAIGN) return Promise.resolve(undefined);
        return Promise.resolve(undefined);
      });
      ruleRepo.findOne.mockResolvedValue({
        id: 'rule-003',
        ruleType: SafetyRuleType.COMPETITOR_MENTION,
        definition: { competitor_name: 'Rival' },
      });
      rulesetRepo.save.mockResolvedValue({ id: 'campaign-ruleset-1' });

      const result = await service.createCampaignOverride(
        'camp-1',
        'account-1',
        { action: 'suppress', supersedes_rule_id: 'rule-003' },
        actor,
      );

      expect(result.rule_type).toBe(SafetyRuleType.COMPETITOR_MENTION);
      expect(result.definition).toBeNull();
      expect(result.action).toBe('suppress');
    });
  });

  it('throws NotFoundException for an unknown campaign', async () => {
    campaignRepo.findOne.mockResolvedValue(undefined);
    await expect(service.getEffectiveCampaignRuleset('missing-campaign', 'account-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('throws UnprocessableEntityException shape for malformed regex at update time too', async () => {
    rulesetRepo.findOne.mockResolvedValue({ id: 'ruleset-1' });
    ruleRepo.findOne.mockResolvedValue({
      id: 'rule-1',
      rulesetId: 'ruleset-1',
      ruleType: SafetyRuleType.RESTRICTED_LANGUAGE,
      definition: { pattern: 'cura garantida', pattern_type: 'keyword' },
    });
    await expect(
      service.updateBrandRule(
        'account-1',
        'rule-1',
        { definition: { pattern: '(bad(', pattern_type: 'regex' } },
        actor,
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});
