import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  Campaign,
  SafetyRuleset,
  SafetyRulesetScope,
  SafetyRule,
  SafetyRuleType,
  SafetyRuleAction,
  SafetyRuleDefinition,
} from '../database/entities';
import { AuditService } from '../audit/audit.service';
import { EffectiveRule } from './adapters/content-safety.adapter';
import { CreateRuleDto } from './dto/create-rule.dto';
import { UpdateRuleDto } from './dto/update-rule.dto';
import { BulkRulesDto } from './dto/bulk-rules.dto';
import { CreateOverrideDto } from './dto/create-override.dto';
import { BulkOverridesDto } from './dto/bulk-overrides.dto';

export interface ActorContext {
  userId: string;
  ipAddress: string;
  userAgent: string;
}

// Thrown by validateDefinition (section 2.3 of the E4 architecture doc).
// Kept as a plain error, not an HttpException, so callers can decide whether
// to attach a `failing_item` to the eventual 422 response (bulk endpoints)
// or not (single-rule endpoints).
class RuleValidationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

@Injectable()
export class RulesetService {
  constructor(
    @InjectRepository(SafetyRuleset)
    private rulesetRepo: Repository<SafetyRuleset>,
    @InjectRepository(SafetyRule)
    private ruleRepo: Repository<SafetyRule>,
    @InjectRepository(Campaign)
    private campaignRepo: Repository<Campaign>,
    private auditService: AuditService,
    private dataSource: DataSource,
  ) {}

  // ================= Brand ruleset (US-15 scenario 1) =================

  // A brand ruleset conceptually always exists, just possibly empty -- an
  // account that never saved a rule gets an empty list, not a 404 (section
  // 3.2 of the E4 architecture doc).
  async getBrandRuleset(accountId: string) {
    const ruleset = await this.rulesetRepo.findOne({
      where: { accountId, scope: SafetyRulesetScope.BRAND },
    });
    if (!ruleset) {
      return { id: null, scope: 'brand', rules: [], updated_at: null };
    }
    const rules = await this.ruleRepo.find({
      where: { rulesetId: ruleset.id },
      order: { createdAt: 'ASC' },
    });
    return {
      id: ruleset.id,
      scope: 'brand',
      rules: rules.map((r) => this.formatRule(r)),
      updated_at: ruleset.updatedAt.toISOString(),
    };
  }

  async createBrandRule(accountId: string, dto: CreateRuleDto, actor: ActorContext) {
    const ruleType = dto.rule_type as SafetyRuleType;
    this.assertValidDefinition(ruleType, dto.definition);

    const ruleset = await this.getOrCreateBrandRuleset(accountId, actor.userId);
    const rule = await this.ruleRepo.save(
      this.ruleRepo.create({
        rulesetId: ruleset.id,
        ruleType,
        definition: dto.definition as SafetyRuleDefinition,
        action: SafetyRuleAction.ADD,
        supersedesRuleId: null,
        createdByUserId: actor.userId,
      }),
    );

    await this.auditService.log({
      actorUserId: actor.userId,
      targetAccountId: accountId,
      action: 'safety_rule.created',
      metadata: { rule_id: rule.id, rule_type: rule.ruleType },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return this.formatRule(rule);
  }

  async updateBrandRule(
    accountId: string,
    ruleId: string,
    dto: UpdateRuleDto,
    actor: ActorContext,
  ) {
    const rule = await this.findBrandRuleOrFail(accountId, ruleId);
    // Partial update: the given fields are merged onto the existing
    // definition, then the merged result is re-validated (section 3.2 of
    // the E4 architecture doc). On failure the rule is left exactly as it
    // was before the request (US-15 scenario 3) -- validated before mutating.
    const merged = { ...(rule.definition as Record<string, any>), ...dto.definition };
    this.assertValidDefinition(rule.ruleType, merged);

    rule.definition = merged as SafetyRuleDefinition;
    const saved = await this.ruleRepo.save(rule);

    await this.auditService.log({
      actorUserId: actor.userId,
      targetAccountId: accountId,
      action: 'safety_rule.updated',
      metadata: { rule_id: saved.id },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return this.formatRule(saved);
  }

  async deleteBrandRule(accountId: string, ruleId: string, actor: ActorContext) {
    const rule = await this.findBrandRuleOrFail(accountId, ruleId);

    const affected = await this.ruleRepo
      .createQueryBuilder('r')
      .innerJoin(SafetyRuleset, 'rs', 'rs.id = r.rulesetId')
      .where('r.supersedesRuleId = :ruleId', { ruleId })
      .andWhere('rs.accountId = :accountId', { accountId })
      .select(['rs.campaignId AS "campaignId"'])
      .getRawMany<{ campaignId: string }>();

    await this.ruleRepo.remove(rule);

    await this.auditService.log({
      actorUserId: actor.userId,
      targetAccountId: accountId,
      action: 'safety_rule.deleted',
      metadata: { rule_id: ruleId },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    const affectedCampaignOverrides = [...new Set(affected.map((a) => a.campaignId))];
    if (affectedCampaignOverrides.length > 0) {
      return { affected_campaign_overrides: affectedCampaignOverrides };
    }
    return undefined;
  }

  // Transactional, all-or-nothing (US-15 scenario 3): every item in
  // create/update is validated before anything is written; on any failure
  // the whole request is rejected and no row in the batch is written or
  // deleted.
  async bulkBrandRules(accountId: string, dto: BulkRulesDto, actor: ActorContext) {
    const creates = dto.create || [];
    const updates = dto.update || [];
    const deletes = dto.delete || [];

    const existingRuleset = await this.rulesetRepo.findOne({
      where: { accountId, scope: SafetyRulesetScope.BRAND },
    });
    const existingRules = existingRuleset
      ? await this.ruleRepo.find({ where: { rulesetId: existingRuleset.id } })
      : [];
    const existingById = new Map(existingRules.map((r) => [r.id, r]));

    creates.forEach((item, index) => {
      this.assertValidDefinition(item.rule_type as SafetyRuleType, item.definition, {
        type: 'create',
        index,
      });
    });

    // Partial update: fields are merged onto each rule's existing
    // definition, then the merged result is re-validated (section 3.2).
    const mergedDefinitions = new Map<string, Record<string, any>>();
    updates.forEach((item) => {
      const existing = existingById.get(item.id);
      if (!existing) {
        throw new NotFoundException({
          error: {
            code: 'RULE_NOT_FOUND',
            message: 'Uma ou mais regras informadas para atualizacao nao foram encontradas.',
            details: { failing_item: item.id },
          },
        });
      }
      const merged = { ...(existing.definition as Record<string, any>), ...item.definition };
      this.assertValidDefinition(existing.ruleType, merged, { type: 'update', id: item.id });
      mergedDefinitions.set(item.id, merged);
    });

    deletes.forEach((id) => {
      if (!existingById.has(id)) {
        throw new NotFoundException({
          error: {
            code: 'RULE_NOT_FOUND',
            message: 'Uma ou mais regras informadas para remocao nao foram encontradas.',
            details: { failing_item: id },
          },
        });
      }
    });

    // All valid: commit atomically.
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    let createdRows: SafetyRule[] = [];
    let updatedRows: SafetyRule[] = [];
    try {
      const ruleset =
        existingRuleset ||
        (await queryRunner.manager.save(
          queryRunner.manager.create(SafetyRuleset, {
            accountId,
            scope: SafetyRulesetScope.BRAND,
            campaignId: null,
            createdByUserId: actor.userId,
          }),
        ));

      if (creates.length > 0) {
        const toCreate = creates.map((item) =>
          queryRunner.manager.create(SafetyRule, {
            rulesetId: ruleset.id,
            ruleType: item.rule_type as SafetyRuleType,
            definition: item.definition as SafetyRuleDefinition,
            action: SafetyRuleAction.ADD,
            supersedesRuleId: null,
            createdByUserId: actor.userId,
          }),
        );
        createdRows = await queryRunner.manager.save(toCreate);
      }

      for (const item of updates) {
        const existing = existingById.get(item.id)!;
        existing.definition = mergedDefinitions.get(item.id) as SafetyRuleDefinition;
        updatedRows.push(await queryRunner.manager.save(existing));
      }

      if (deletes.length > 0) {
        await queryRunner.manager.delete(SafetyRule, deletes);
      }

      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }

    await this.auditService.log({
      actorUserId: actor.userId,
      targetAccountId: accountId,
      action: 'safety_rules.bulk_updated',
      metadata: {
        created: createdRows.map((r) => r.id),
        updated: updatedRows.map((r) => r.id),
        deleted: deletes,
      },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return {
      created: createdRows.map((r) => this.formatRule(r)),
      updated: updatedRows.map((r) => this.formatRule(r)),
      deleted: deletes,
    };
  }

  // ================= Campaign effective ruleset (US-15 scenario 2) =================

  // Computed at read time, never materialized (section 3.2 of the E4
  // architecture doc) -- a later brand-rule edit is reflected immediately in
  // every campaign that has not specifically overridden it.
  async getEffectiveCampaignRuleset(campaignId: string, accountId: string) {
    await this.findCampaignOrFail(campaignId, accountId);
    const { brandRules, overrideRules, supersededIds } = await this.resolveEffectiveRuleRows(
      campaignId,
      accountId,
    );

    const effectiveRules = [
      ...brandRules
        .filter((r) => !supersededIds.has(r.id))
        .map((r) => ({
          id: r.id,
          rule_type: r.ruleType,
          definition: r.definition,
          source: 'brand' as const,
        })),
      ...overrideRules.map((r) => ({
        id: r.id,
        rule_type: r.ruleType,
        definition: r.definition,
        source: 'campaign_override' as const,
        override_action: r.action,
        supersedes_rule_id: r.supersedesRuleId,
      })),
    ];

    return {
      campaign_id: campaignId,
      has_override: overrideRules.length > 0,
      effective_rules: effectiveRules,
      override_rule_ids: overrideRules.map((r) => r.id),
    };
  }

  async createCampaignOverride(
    campaignId: string,
    accountId: string,
    dto: CreateOverrideDto,
    actor: ActorContext,
  ) {
    await this.findCampaignOrFail(campaignId, accountId);

    let supersededRule: SafetyRule | null = null;
    if (dto.action === 'replace' || dto.action === 'suppress') {
      supersededRule = await this.resolveBrandRuleForSupersession(
        accountId,
        dto.supersedes_rule_id!,
      );
    }

    let ruleType: SafetyRuleType;
    let definition: SafetyRuleDefinition | null;
    if (dto.action === 'suppress') {
      ruleType = supersededRule!.ruleType;
      definition = null;
    } else {
      ruleType = dto.rule_type as SafetyRuleType;
      this.assertValidDefinition(ruleType, dto.definition);
      definition = dto.definition as SafetyRuleDefinition;
    }

    const ruleset = await this.getOrCreateCampaignRuleset(campaignId, accountId, actor.userId);
    const rule = await this.ruleRepo.save(
      this.ruleRepo.create({
        rulesetId: ruleset.id,
        ruleType,
        definition,
        action: dto.action as SafetyRuleAction,
        supersedesRuleId: dto.action === 'add' ? null : dto.supersedes_rule_id!,
        createdByUserId: actor.userId,
      }),
    );

    await this.auditService.log({
      actorUserId: actor.userId,
      targetAccountId: accountId,
      action: 'safety_rule.campaign_override_created',
      metadata: { campaign_id: campaignId, rule_id: rule.id, override_action: dto.action },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return this.formatRule(rule);
  }

  async updateCampaignOverride(
    campaignId: string,
    accountId: string,
    ruleId: string,
    dto: UpdateRuleDto,
    actor: ActorContext,
  ) {
    await this.findCampaignOrFail(campaignId, accountId);
    const rule = await this.findCampaignOverrideRuleOrFail(campaignId, ruleId);

    if (rule.action === SafetyRuleAction.SUPPRESS) {
      throw new UnprocessableEntityException({
        error: {
          code: 'SUPPRESS_OVERRIDE_HAS_NO_DEFINITION',
          message: 'Uma regra de suspensao nao possui definicao para ser atualizada.',
          details: {},
        },
      });
    }

    const merged = { ...(rule.definition as Record<string, any>), ...dto.definition };
    this.assertValidDefinition(rule.ruleType, merged);
    rule.definition = merged as SafetyRuleDefinition;
    const saved = await this.ruleRepo.save(rule);

    await this.auditService.log({
      actorUserId: actor.userId,
      targetAccountId: accountId,
      action: 'safety_rule.campaign_override_updated',
      metadata: { campaign_id: campaignId, rule_id: saved.id },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return this.formatRule(saved);
  }

  async deleteCampaignOverride(
    campaignId: string,
    accountId: string,
    ruleId: string,
    actor: ActorContext,
  ) {
    await this.findCampaignOrFail(campaignId, accountId);
    const rule = await this.findCampaignOverrideRuleOrFail(campaignId, ruleId);
    await this.ruleRepo.remove(rule);

    await this.auditService.log({
      actorUserId: actor.userId,
      targetAccountId: accountId,
      action: 'safety_rule.campaign_override_deleted',
      metadata: { campaign_id: campaignId, rule_id: ruleId },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
  }

  async bulkCampaignOverrides(
    campaignId: string,
    accountId: string,
    dto: BulkOverridesDto,
    actor: ActorContext,
  ) {
    await this.findCampaignOrFail(campaignId, accountId);

    const creates = dto.create || [];
    const updates = dto.update || [];
    const deletes = dto.delete || [];

    const existingRuleset = await this.rulesetRepo.findOne({
      where: { campaignId, scope: SafetyRulesetScope.CAMPAIGN },
    });
    const existingRules = existingRuleset
      ? await this.ruleRepo.find({ where: { rulesetId: existingRuleset.id } })
      : [];
    const existingById = new Map(existingRules.map((r) => [r.id, r]));

    // Validate every create item, resolving supersedes_rule_id references
    // along the way (also validated here, before any write).
    const resolvedCreates: Array<{
      dto: CreateOverrideDto;
      ruleType: SafetyRuleType;
      definition: SafetyRuleDefinition | null;
    }> = [];
    for (let index = 0; index < creates.length; index++) {
      const item = creates[index];
      let supersededRule: SafetyRule | null = null;
      if (item.action === 'replace' || item.action === 'suppress') {
        supersededRule = await this.resolveBrandRuleForSupersession(
          accountId,
          item.supersedes_rule_id!,
          { type: 'create', index },
        );
      }
      let ruleType: SafetyRuleType;
      let definition: SafetyRuleDefinition | null;
      if (item.action === 'suppress') {
        ruleType = supersededRule!.ruleType;
        definition = null;
      } else {
        ruleType = item.rule_type as SafetyRuleType;
        this.assertValidDefinition(ruleType, item.definition, { type: 'create', index });
        definition = item.definition as SafetyRuleDefinition;
      }
      resolvedCreates.push({ dto: item, ruleType, definition });
    }

    const mergedDefinitions = new Map<string, Record<string, any>>();
    updates.forEach((item) => {
      const existing = existingById.get(item.id);
      if (!existing) {
        throw new NotFoundException({
          error: {
            code: 'OVERRIDE_NOT_FOUND',
            message: 'Uma ou mais sobreposicoes informadas nao foram encontradas.',
            details: { failing_item: item.id },
          },
        });
      }
      if (existing.action === SafetyRuleAction.SUPPRESS) {
        throw new UnprocessableEntityException({
          error: {
            code: 'SUPPRESS_OVERRIDE_HAS_NO_DEFINITION',
            message: 'Uma regra de suspensao nao possui definicao para ser atualizada.',
            details: { failing_item: item.id },
          },
        });
      }
      const merged = { ...(existing.definition as Record<string, any>), ...item.definition };
      this.assertValidDefinition(existing.ruleType, merged, { type: 'update', id: item.id });
      mergedDefinitions.set(item.id, merged);
    });

    deletes.forEach((id) => {
      if (!existingById.has(id)) {
        throw new NotFoundException({
          error: {
            code: 'OVERRIDE_NOT_FOUND',
            message: 'Uma ou mais sobreposicoes informadas para remocao nao foram encontradas.',
            details: { failing_item: id },
          },
        });
      }
    });

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    let createdRows: SafetyRule[] = [];
    let updatedRows: SafetyRule[] = [];
    try {
      const ruleset =
        existingRuleset ||
        (await queryRunner.manager.save(
          queryRunner.manager.create(SafetyRuleset, {
            accountId,
            scope: SafetyRulesetScope.CAMPAIGN,
            campaignId,
            createdByUserId: actor.userId,
          }),
        ));

      if (resolvedCreates.length > 0) {
        const toCreate = resolvedCreates.map((rc) =>
          queryRunner.manager.create(SafetyRule, {
            rulesetId: ruleset.id,
            ruleType: rc.ruleType,
            definition: rc.definition,
            action: rc.dto.action as SafetyRuleAction,
            supersedesRuleId: rc.dto.action === 'add' ? null : rc.dto.supersedes_rule_id!,
            createdByUserId: actor.userId,
          }),
        );
        createdRows = await queryRunner.manager.save(toCreate);
      }

      for (const item of updates) {
        const existing = existingById.get(item.id)!;
        existing.definition = mergedDefinitions.get(item.id) as SafetyRuleDefinition;
        updatedRows.push(await queryRunner.manager.save(existing));
      }

      if (deletes.length > 0) {
        await queryRunner.manager.delete(SafetyRule, deletes);
      }

      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }

    await this.auditService.log({
      actorUserId: actor.userId,
      targetAccountId: accountId,
      action: 'safety_rules.bulk_campaign_override_updated',
      metadata: {
        campaign_id: campaignId,
        created: createdRows.map((r) => r.id),
        updated: updatedRows.map((r) => r.id),
        deleted: deletes,
      },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return {
      created: createdRows.map((r) => this.formatRule(r)),
      updated: updatedRows.map((r) => this.formatRule(r)),
      deleted: deletes,
    };
  }

  // ================= Consumed by content-submission intake / run-safety-check =================

  // Bookkeeping only (PRD open question 2 is explicitly left unresolved by
  // this epic): records which ruleset was governing at check time, not a
  // full snapshot of rule content.
  async resolveGoverningRulesetId(campaignId: string, accountId: string): Promise<string | null> {
    const { brandRuleset, campaignRuleset } = await this.resolveEffectiveRuleRows(
      campaignId,
      accountId,
    );
    if (campaignRuleset) return campaignRuleset.id;
    if (brandRuleset) return brandRuleset.id;
    return null;
  }

  // The actual rules ContentSafetyAdapter evaluates: brand rules not
  // superseded, plus campaign-scope add/replace rules. Suppress entries
  // carry no definition and are excluded here (ADR-0019) -- they only ever
  // function as an exclusion directive, never as something to evaluate.
  async computeEffectiveRulesForEvaluation(
    campaignId: string,
    accountId: string,
  ): Promise<EffectiveRule[]> {
    const { brandRules, overrideRules, supersededIds } = await this.resolveEffectiveRuleRows(
      campaignId,
      accountId,
    );

    const evaluable: EffectiveRule[] = [];
    for (const r of brandRules) {
      if (supersededIds.has(r.id)) continue;
      evaluable.push({ ruleId: r.id, ruleType: r.ruleType, definition: r.definition as SafetyRuleDefinition });
    }
    for (const r of overrideRules) {
      if (r.action === SafetyRuleAction.SUPPRESS) continue;
      evaluable.push({ ruleId: r.id, ruleType: r.ruleType, definition: r.definition as SafetyRuleDefinition });
    }
    return evaluable;
  }

  // ================= Shared helpers =================

  private async resolveEffectiveRuleRows(campaignId: string, accountId: string) {
    const brandRuleset = await this.rulesetRepo.findOne({
      where: { accountId, scope: SafetyRulesetScope.BRAND },
    });
    const brandRules = brandRuleset
      ? await this.ruleRepo.find({ where: { rulesetId: brandRuleset.id }, order: { createdAt: 'ASC' } })
      : [];

    const campaignRuleset = await this.rulesetRepo.findOne({
      where: { campaignId, scope: SafetyRulesetScope.CAMPAIGN },
    });
    const overrideRules = campaignRuleset
      ? await this.ruleRepo.find({ where: { rulesetId: campaignRuleset.id }, order: { createdAt: 'ASC' } })
      : [];

    const supersededIds = new Set(
      overrideRules
        .filter((r) => r.action !== SafetyRuleAction.ADD)
        .map((r) => r.supersedesRuleId as string),
    );

    return { brandRuleset, brandRules, campaignRuleset, overrideRules, supersededIds };
  }

  private async getOrCreateBrandRuleset(accountId: string, userId: string): Promise<SafetyRuleset> {
    let ruleset = await this.rulesetRepo.findOne({
      where: { accountId, scope: SafetyRulesetScope.BRAND },
    });
    if (!ruleset) {
      ruleset = await this.rulesetRepo.save(
        this.rulesetRepo.create({
          accountId,
          scope: SafetyRulesetScope.BRAND,
          campaignId: null,
          createdByUserId: userId,
        }),
      );
    }
    return ruleset;
  }

  private async getOrCreateCampaignRuleset(
    campaignId: string,
    accountId: string,
    userId: string,
  ): Promise<SafetyRuleset> {
    let ruleset = await this.rulesetRepo.findOne({
      where: { campaignId, scope: SafetyRulesetScope.CAMPAIGN },
    });
    if (!ruleset) {
      ruleset = await this.rulesetRepo.save(
        this.rulesetRepo.create({
          accountId,
          scope: SafetyRulesetScope.CAMPAIGN,
          campaignId,
          createdByUserId: userId,
        }),
      );
    }
    return ruleset;
  }

  private async findCampaignOrFail(campaignId: string, accountId: string): Promise<Campaign> {
    const campaign = await this.campaignRepo.findOne({ where: { id: campaignId, accountId } });
    if (!campaign) {
      throw new NotFoundException({
        error: { code: 'CAMPAIGN_NOT_FOUND', message: 'Campanha nao encontrada.', details: {} },
      });
    }
    return campaign;
  }

  private async findBrandRuleOrFail(accountId: string, ruleId: string): Promise<SafetyRule> {
    const ruleset = await this.rulesetRepo.findOne({
      where: { accountId, scope: SafetyRulesetScope.BRAND },
    });
    const rule = ruleset
      ? await this.ruleRepo.findOne({ where: { id: ruleId, rulesetId: ruleset.id } })
      : null;
    if (!rule) {
      throw new NotFoundException({
        error: { code: 'RULE_NOT_FOUND', message: 'Regra nao encontrada.', details: {} },
      });
    }
    return rule;
  }

  private async findCampaignOverrideRuleOrFail(campaignId: string, ruleId: string): Promise<SafetyRule> {
    const ruleset = await this.rulesetRepo.findOne({
      where: { campaignId, scope: SafetyRulesetScope.CAMPAIGN },
    });
    const rule = ruleset
      ? await this.ruleRepo.findOne({ where: { id: ruleId, rulesetId: ruleset.id } })
      : null;
    if (!rule) {
      throw new NotFoundException({
        error: { code: 'OVERRIDE_NOT_FOUND', message: 'Sobreposicao nao encontrada.', details: {} },
      });
    }
    return rule;
  }

  // supersedes_rule_id must belong to this account's brand-scope ruleset --
  // not another campaign's override, not a different account's rule
  // entirely (section 3.2 of the E4 architecture doc).
  private async resolveBrandRuleForSupersession(
    accountId: string,
    supersedesRuleId: string,
    failingItem?: any,
  ): Promise<SafetyRule> {
    const brandRuleset = await this.rulesetRepo.findOne({
      where: { accountId, scope: SafetyRulesetScope.BRAND },
    });
    const rule = brandRuleset
      ? await this.ruleRepo.findOne({ where: { id: supersedesRuleId, rulesetId: brandRuleset.id } })
      : null;
    if (!rule) {
      throw new UnprocessableEntityException({
        error: {
          code: 'INVALID_SUPERSEDES_REFERENCE',
          message:
            'A regra referenciada em supersedes_rule_id nao pertence ao conjunto de regras de marca desta conta.',
          details: failingItem ? { failing_item: failingItem } : {},
        },
      });
    }
    return rule;
  }

  private assertValidDefinition(
    ruleType: SafetyRuleType,
    definition: Record<string, any> | undefined,
    failingItem?: any,
  ): void {
    try {
      this.validateDefinition(ruleType, definition);
    } catch (error) {
      if (error instanceof RuleValidationError) {
        throw new UnprocessableEntityException({
          error: {
            code: error.code,
            message: error.message,
            details: failingItem ? { failing_item: failingItem } : {},
          },
        });
      }
      throw error;
    }
  }

  // Section 2.3 of the E4 architecture doc: enforced here, before any row is
  // written, never partially.
  private validateDefinition(ruleType: SafetyRuleType, definition: Record<string, any> | undefined): void {
    switch (ruleType) {
      case SafetyRuleType.PROHIBITED_TOPIC: {
        const topic = definition?.topic;
        if (typeof topic !== 'string' || topic.length < 2 || topic.length > 200) {
          throw new RuleValidationError(
            'RULE_TOPIC_INVALID',
            'O topico deve ser um texto com 2 a 200 caracteres.',
          );
        }
        return;
      }
      case SafetyRuleType.RESTRICTED_LANGUAGE: {
        const pattern = definition?.pattern;
        const patternType = definition?.pattern_type;
        if (typeof pattern !== 'string' || pattern.length < 1 || pattern.length > 500) {
          throw new RuleValidationError(
            'RULE_PATTERN_INVALID',
            'O padrao deve ser um texto com 1 a 500 caracteres.',
          );
        }
        if (patternType !== undefined && patternType !== 'keyword' && patternType !== 'regex') {
          throw new RuleValidationError(
            'RULE_PATTERN_INVALID',
            'pattern_type deve ser "keyword" ou "regex".',
          );
        }
        if (patternType === 'regex') {
          if (pattern.trim().length === 0) {
            throw new RuleValidationError(
              'RULE_PATTERN_INVALID',
              'padrao de expressao regular invalido: padrao vazio.',
            );
          }
          try {
            // eslint-disable-next-line no-new
            new RegExp(pattern);
          } catch {
            throw new RuleValidationError(
              'RULE_PATTERN_INVALID',
              'padrao de expressao regular invalido.',
            );
          }
        }
        return;
      }
      case SafetyRuleType.COMPETITOR_MENTION: {
        const competitorName = definition?.competitor_name;
        if (
          typeof competitorName !== 'string' ||
          competitorName.length < 2 ||
          competitorName.length > 200 ||
          !/[a-zA-ZÀ-ÿ]/.test(competitorName)
        ) {
          throw new RuleValidationError(
            'RULE_COMPETITOR_UNRESOLVED',
            'competitor_name deve ter 2 a 200 caracteres e nao pode ser puramente numerico ou simbolico.',
          );
        }
        const aliases = definition?.aliases;
        if (aliases !== undefined) {
          if (!Array.isArray(aliases)) {
            throw new RuleValidationError('RULE_COMPETITOR_UNRESOLVED', 'aliases deve ser uma lista de textos.');
          }
          for (const alias of aliases) {
            if (typeof alias !== 'string' || alias.length < 2 || alias.length > 200) {
              throw new RuleValidationError(
                'RULE_COMPETITOR_UNRESOLVED',
                'cada alias deve ter 2 a 200 caracteres.',
              );
            }
          }
        }
        return;
      }
      default:
        throw new RuleValidationError('RULE_TYPE_INVALID', 'rule_type invalido.');
    }
  }

  private formatRule(rule: SafetyRule) {
    return {
      id: rule.id,
      rule_type: rule.ruleType,
      definition: rule.definition,
      action: rule.action,
      supersedes_rule_id: rule.supersedesRuleId,
      created_at: rule.createdAt.toISOString(),
    };
  }
}
