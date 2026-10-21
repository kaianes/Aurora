import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Account,
  Campaign,
  CampaignState,
  CampaignTemplate,
  CampaignStateTransition,
  BrandProfile,
  Role,
} from '../database/entities';
import { AuditService } from '../audit/audit.service';
import { AccountAccessService, JwtMembership } from '../common/account-access.service';
import { TemplateCopyService } from '../agency/template-copy.service';
import { SaveTemplateDto } from './dto/save-template.dto';
import { InstantiateTemplateDto } from './dto/instantiate-template.dto';
import { AcknowledgeDriftDto } from './dto/acknowledge-drift.dto';
import { CopyTemplateDto } from './dto/copy-template.dto';

interface ActorContext {
  userId: string;
  ipAddress: string;
  userAgent: string;
}

@Injectable()
export class TemplateService {
  constructor(
    @InjectRepository(Campaign)
    private campaignRepo: Repository<Campaign>,
    @InjectRepository(CampaignTemplate)
    private templateRepo: Repository<CampaignTemplate>,
    @InjectRepository(CampaignStateTransition)
    private transitionRepo: Repository<CampaignStateTransition>,
    @InjectRepository(BrandProfile)
    private brandProfileRepo: Repository<BrandProfile>,
    @InjectRepository(Account)
    private accountRepo: Repository<Account>,
    private auditService: AuditService,
    private accountAccessService: AccountAccessService,
    private templateCopyService: TemplateCopyService,
  ) {}

  async saveAsTemplate(
    campaignId: string,
    accountId: string,
    dto: SaveTemplateDto,
    actor: ActorContext,
  ) {
    const campaign = await this.campaignRepo.findOne({
      where: { id: campaignId, accountId },
    });
    if (!campaign) {
      throw new NotFoundException({
        error: { code: 'CAMPAIGN_NOT_FOUND', message: 'Campanha nao encontrada.', details: {} },
      });
    }

    const nonTerminalDraft = campaign.state === CampaignState.DRAFT;
    if (nonTerminalDraft) {
      throw new BadRequestException({
        error: {
          code: 'CAMPAIGN_NOT_CONFIRMED',
          message: 'Apenas campanhas que passaram por cotacao/confirmacao podem ser salvas como modelo.',
          details: { state: campaign.state },
        },
      });
    }

    let durationDays = 30;
    if (campaign.timelineStart && campaign.timelineEnd) {
      durationDays = Math.max(
        1,
        Math.round(
          (campaign.timelineEnd.getTime() - campaign.timelineStart.getTime()) /
            (24 * 60 * 60 * 1000),
        ),
      );
    }

    const brandProfile = await this.brandProfileRepo.findOne({ where: { accountId } });

    const template = this.templateRepo.create({
      accountId,
      sourceCampaignId: campaign.id,
      name: dto.name,
      audienceTargeting: campaign.audienceTargeting,
      message: campaign.message,
      deliverableFormats: campaign.deliverableFormats,
      timelineShape: { duration_days: durationDays },
      brandProfileSnapshot: {
        prohibited_topics: brandProfile?.prohibitedTopics || null,
        tone_of_voice: brandProfile?.toneOfVoice || null,
      },
    });
    const saved = await this.templateRepo.save(template);

    await this.auditService.log({
      actorUserId: actor.userId,
      targetAccountId: accountId,
      action: 'campaign_template.created',
      metadata: { template_id: saved.id, source_campaign_id: campaign.id },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return this.formatTemplate(saved);
  }

  async list(accountId: string) {
    const templates = await this.templateRepo.find({
      where: { accountId },
      order: { createdAt: 'DESC' },
    });
    return {
      data: templates.map((t) => ({
        id: t.id,
        name: t.name,
        created_at: t.createdAt.toISOString(),
        source_campaign_id: t.sourceCampaignId,
      })),
      pagination: { next_cursor: null, has_more: false },
    };
  }

  async instantiate(
    templateId: string,
    accountId: string,
    dto: InstantiateTemplateDto,
    actor: ActorContext,
  ) {
    const template = await this.templateRepo.findOne({
      where: { id: templateId, accountId },
    });
    if (!template) {
      throw new NotFoundException({
        error: { code: 'TEMPLATE_NOT_FOUND', message: 'Modelo nao encontrado.', details: {} },
      });
    }

    const brandProfile = await this.brandProfileRepo.findOne({ where: { accountId } });
    const drift = this.computeDrift(template, brandProfile);

    const timelineStart = new Date(dto.timeline_start);
    const durationDays = template.timelineShape?.duration_days || 30;
    const timelineEnd = new Date(
      timelineStart.getTime() + durationDays * 24 * 60 * 60 * 1000,
    );

    const campaign = this.campaignRepo.create({
      accountId,
      createdByUserId: actor.userId,
      templateId: template.id,
      name: dto.name,
      budgetAmount: dto.budget_amount,
      audienceTargeting: template.audienceTargeting,
      message: template.message,
      deliverableFormats: template.deliverableFormats,
      timelineStart,
      timelineEnd,
      brandProfileDrift: drift,
      state: CampaignState.DRAFT,
    });
    campaign.missingFields = this.computeMissingFields(campaign).join(',');

    const saved = await this.campaignRepo.save(campaign);
    await this.transitionRepo.save(
      this.transitionRepo.create({
        campaignId: saved.id,
        fromState: null,
        toState: CampaignState.DRAFT,
        actorUserId: actor.userId,
      }),
    );

    await this.auditService.log({
      actorUserId: actor.userId,
      targetAccountId: accountId,
      action: 'campaign_template.instantiated',
      metadata: { template_id: template.id, campaign_id: saved.id, drift },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return {
      id: saved.id,
      state: saved.state,
      template_id: saved.templateId,
      name: saved.name,
      budget_amount: saved.budgetAmount,
      audience_targeting: saved.audienceTargeting,
      message: saved.message,
      deliverable_formats: saved.deliverableFormats,
      timeline_start: saved.timelineStart?.toISOString() || null,
      timeline_end: saved.timelineEnd?.toISOString() || null,
      brand_profile_drift: saved.brandProfileDrift || [],
      missing_fields: saved.missingFields ? saved.missingFields.split(',').filter(Boolean) : [],
      created_at: saved.createdAt.toISOString(),
    };
  }

  async acknowledgeDrift(
    campaignId: string,
    accountId: string,
    dto: AcknowledgeDriftDto,
    actor: ActorContext,
  ) {
    const campaign = await this.campaignRepo.findOne({
      where: { id: campaignId, accountId },
    });
    if (!campaign) {
      throw new NotFoundException({
        error: { code: 'CAMPAIGN_NOT_FOUND', message: 'Campanha nao encontrada.', details: {} },
      });
    }

    const remaining = (campaign.brandProfileDrift || []).filter(
      (field) => !dto.acknowledged_fields.includes(field),
    );

    // Overrides (if provided) are recorded in the audit trail only; E2 does
    // not mutate the account's brand profile itself, only unblocks this
    // campaign's quote once every flagged field has been acknowledged.
    campaign.brandProfileDrift = remaining;
    const saved = await this.campaignRepo.save(campaign);

    await this.auditService.log({
      actorUserId: actor.userId,
      targetAccountId: accountId,
      action: 'campaign.drift_acknowledged',
      metadata: { campaign_id: campaignId, acknowledged_fields: dto.acknowledged_fields },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return {
      id: saved.id,
      brand_profile_drift: saved.brandProfileDrift || [],
    };
  }

  // Section 4.2 of the E9 architecture doc (US-41, ADR-0060): the ongoing,
  // after-the-fact copy action. currentRole and memberships come from the
  // already-authenticated caller (RolesGuard has already confirmed they
  // hold agency_admin or agency_operator on accountId, the source) --
  // the one genuinely new authorization check this epic adds is the
  // target-account resolution below, since RolesGuard/RLS only ever
  // resolve one account per request.
  async copyTemplate(
    templateId: string,
    accountId: string,
    currentRole: string,
    dto: CopyTemplateDto,
    memberships: JwtMembership[],
    actor: ActorContext,
  ) {
    const template = await this.templateRepo.findOne({
      where: { id: templateId, accountId },
    });
    if (!template) {
      throw new NotFoundException({
        error: { code: 'TEMPLATE_NOT_FOUND', message: 'Modelo nao encontrado.', details: {} },
      });
    }

    const sourceAccount = await this.accountRepo.findOne({ where: { id: accountId } });
    if (!sourceAccount) {
      throw new NotFoundException({
        error: { code: 'TEMPLATE_NOT_FOUND', message: 'Modelo nao encontrado.', details: {} },
      });
    }

    if (dto.target_account_id === accountId) {
      throw new BadRequestException({
        error: {
          code: 'INVALID_TARGET',
          message: 'O cliente de destino deve ser diferente do cliente de origem.',
          details: {},
        },
      });
    }

    // One code for "does not exist" and "exists, different workspace" --
    // the same discipline every cross-client lookup in this platform
    // already applies (US-41 scenario 3, applied symmetrically to the
    // target).
    const targetAccount = await this.accountRepo.findOne({
      where: { id: dto.target_account_id, workspaceId: sourceAccount.workspaceId },
    });
    if (!targetAccount) {
      throw new NotFoundException({
        error: {
          code: 'CLIENT_NOT_FOUND',
          message: 'Conta de cliente de destino nao encontrada neste workspace.',
          details: {},
        },
      });
    }

    // The one genuinely new authorization check (section 4.2, step 4): an
    // agency_admin has implicit access to every client in their own
    // workspace, already confirmed by the workspace match above. An
    // agency_operator's access is per-client, so it must be checked
    // explicitly for the target, which RolesGuard never does on its own.
    if (currentRole === Role.AGENCY_OPERATOR) {
      const resolvedRole = await this.accountAccessService.resolveAccess(
        actor.userId,
        memberships,
        dto.target_account_id,
      );
      if (!resolvedRole) {
        await this.auditService.log({
          actorUserId: actor.userId,
          targetAccountId: dto.target_account_id,
          action: 'authorization.denied',
          metadata: {
            reason: 'template_copy_target_inaccessible',
            source_account_id: accountId,
            source_template_id: templateId,
          },
          ipAddress: actor.ipAddress,
          userAgent: actor.userAgent,
        });
        throw new ForbiddenException({
          error: {
            code: 'TARGET_NOT_ACCESSIBLE',
            message: 'Voce nao tem acesso ao cliente de destino.',
            details: {},
          },
        });
      }
    }

    const copied = await this.templateCopyService.copyOne(
      template,
      dto.target_account_id,
      sourceAccount.workspaceId,
    );

    await this.auditService.log({
      actorUserId: actor.userId,
      targetAccountId: dto.target_account_id,
      action: 'campaign_template.copied',
      metadata: {
        source_account_id: accountId,
        source_template_id: templateId,
        target_account_id: dto.target_account_id,
        target_template_id: copied.id,
      },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return this.formatTemplate(copied);
  }

  private computeDrift(
    template: CampaignTemplate,
    brandProfile: BrandProfile | null,
  ): string[] {
    const drift: string[] = [];
    if (!template.brandProfileSnapshot) return drift;

    const currentProhibited = brandProfile?.prohibitedTopics || [];
    const snapshotProhibited = template.brandProfileSnapshot.prohibited_topics || [];
    if (
      JSON.stringify([...currentProhibited].sort()) !==
      JSON.stringify([...snapshotProhibited].sort())
    ) {
      drift.push('prohibited_topics');
    }

    if ((brandProfile?.toneOfVoice || null) !== (template.brandProfileSnapshot.tone_of_voice || null)) {
      drift.push('tone_of_voice');
    }

    return drift;
  }

  private computeMissingFields(campaign: Partial<Campaign>): string[] {
    const missing: string[] = [];
    if (!campaign.budgetAmount) missing.push('budget_amount');
    if (!campaign.audienceTargeting) missing.push('audience_targeting');
    if (!campaign.message) missing.push('message');
    if (!campaign.deliverableFormats || campaign.deliverableFormats.length === 0)
      missing.push('deliverable_formats');
    if (!campaign.timelineStart) missing.push('timeline_start');
    if (!campaign.timelineEnd) missing.push('timeline_end');
    return missing;
  }

  private formatTemplate(template: CampaignTemplate) {
    return {
      id: template.id,
      account_id: template.accountId,
      source_campaign_id: template.sourceCampaignId,
      copied_from_template_id: template.copiedFromTemplateId,
      name: template.name,
      audience_targeting: template.audienceTargeting,
      message: template.message,
      deliverable_formats: template.deliverableFormats,
      timeline_shape: template.timelineShape,
      created_at: template.createdAt.toISOString(),
    };
  }
}
