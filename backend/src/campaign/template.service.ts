import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Campaign,
  CampaignState,
  CampaignTemplate,
  CampaignStateTransition,
  BrandProfile,
} from '../database/entities';
import { AuditService } from '../audit/audit.service';
import { SaveTemplateDto } from './dto/save-template.dto';
import { InstantiateTemplateDto } from './dto/instantiate-template.dto';
import { AcknowledgeDriftDto } from './dto/acknowledge-drift.dto';

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
    private auditService: AuditService,
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
      name: template.name,
      audience_targeting: template.audienceTargeting,
      message: template.message,
      deliverable_formats: template.deliverableFormats,
      timeline_shape: template.timelineShape,
      created_at: template.createdAt.toISOString(),
    };
  }
}
