import {
  Injectable,
  NotFoundException,
  BadRequestException,
  UnprocessableEntityException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Repository } from 'typeorm';
import {
  Campaign,
  CampaignState,
  CampaignQuote,
  CampaignQuoteStatus,
  CampaignStateTransition,
  ReallocationBounds,
  PoolShortfallResolution,
  ShortfallResolutionType,
  ShortfallChosenBy,
  CampaignReallocationEvent,
  BrandProfile,
} from '../database/entities';
import { AuditService } from '../audit/audit.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';
import { LifecycleActionDto } from './dto/lifecycle-action.dto';
import { ResolveShortfallDto } from './dto/resolve-shortfall.dto';
import { ReallocationBoundsDto } from './dto/reallocation-bounds.dto';

const CAMPAIGN_MINIMUM_BUDGET = 2000.0;
const QUOTE_REQUIRED_FIELDS = [
  'budget_amount',
  'audience_targeting',
  'message',
  'deliverable_formats',
] as const;

interface ActorContext {
  userId: string;
  ipAddress: string;
  userAgent: string;
}

@Injectable()
export class CampaignService {
  constructor(
    @InjectRepository(Campaign)
    private campaignRepo: Repository<Campaign>,
    @InjectRepository(CampaignQuote)
    private quoteRepo: Repository<CampaignQuote>,
    @InjectRepository(CampaignStateTransition)
    private transitionRepo: Repository<CampaignStateTransition>,
    @InjectRepository(ReallocationBounds)
    private boundsRepo: Repository<ReallocationBounds>,
    @InjectRepository(PoolShortfallResolution)
    private shortfallRepo: Repository<PoolShortfallResolution>,
    @InjectRepository(CampaignReallocationEvent)
    private reallocationEventRepo: Repository<CampaignReallocationEvent>,
    @InjectRepository(BrandProfile)
    private brandProfileRepo: Repository<BrandProfile>,
    @InjectQueue('campaign')
    private campaignQueue: Queue,
    private auditService: AuditService,
  ) {}

  // ---- Validation helpers ----

  private validateBudget(budgetAmount: string | undefined) {
    if (budgetAmount === undefined || budgetAmount === null) return;
    const value = parseFloat(budgetAmount);
    if (Number.isNaN(value) || value < CAMPAIGN_MINIMUM_BUDGET) {
      throw new UnprocessableEntityException({
        error: {
          code: 'BUDGET_BELOW_MINIMUM',
          message: `O orcamento minimo da campanha e R$ ${CAMPAIGN_MINIMUM_BUDGET.toFixed(2)}.`,
          details: { minimum_budget: CAMPAIGN_MINIMUM_BUDGET.toFixed(2) },
        },
      });
    }
  }

  // Synchronous, cheap pre-check distinct from the full async quote (US-05 scenario 3).
  private async validateTargetingNotTooNarrow(
    audienceTargeting: Record<string, any> | undefined,
  ) {
    if (!audienceTargeting) return;
    const geography = audienceTargeting.geography || [];
    const interests = audienceTargeting.interests || [];
    const ageRange = audienceTargeting.age_range;

    // Zero addressable creators only when every dimension is maximally narrow.
    const noGeography = Array.isArray(geography) && geography.length === 0 && 'geography' in audienceTargeting;
    const noInterests = Array.isArray(interests) && interests.length === 0 && 'interests' in audienceTargeting;
    const zeroAgeSpan = Array.isArray(ageRange) && ageRange.length === 2 && ageRange[1] <= ageRange[0];

    if (noGeography && noInterests && zeroAgeSpan) {
      throw new UnprocessableEntityException({
        error: {
          code: 'TARGETING_TOO_NARROW',
          message:
            'Nenhum criador disponivel para esta combinacao de publico. Tente ampliar a geografia ou os interesses.',
          details: {},
        },
      });
    }
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

  private async writeTransition(
    campaignId: string,
    fromState: string | null,
    toState: string,
    actorUserId: string | null,
    reason: string | null = null,
  ) {
    const transition = this.transitionRepo.create({
      campaignId,
      fromState,
      toState,
      actorUserId,
      reason,
    });
    await this.transitionRepo.save(transition);
  }

  // ---- CRUD ----

  async create(accountId: string, dto: CreateCampaignDto, actor: ActorContext) {
    this.validateBudget(dto.budget_amount);
    await this.validateTargetingNotTooNarrow(dto.audience_targeting);

    const campaign = this.campaignRepo.create({
      accountId,
      createdByUserId: actor.userId,
      name: dto.name,
      budgetAmount: dto.budget_amount ?? null,
      budgetCurrency: dto.budget_currency || 'BRL',
      audienceTargeting: dto.audience_targeting ?? null,
      message: dto.message ?? null,
      deliverableFormats: dto.deliverable_formats ?? null,
      timelineStart: dto.timeline_start ? new Date(dto.timeline_start) : null,
      timelineEnd: dto.timeline_end ? new Date(dto.timeline_end) : null,
      state: CampaignState.DRAFT,
    });
    campaign.missingFields = this.computeMissingFields(campaign).join(',');

    const saved = await this.campaignRepo.save(campaign);
    await this.writeTransition(saved.id, null, CampaignState.DRAFT, actor.userId);

    await this.auditService.log({
      actorUserId: actor.userId,
      targetAccountId: accountId,
      action: 'campaign.created',
      metadata: { campaign_id: saved.id },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return this.formatCampaign(saved, await this.brandProfileStatus(accountId));
  }

  async update(
    id: string,
    accountId: string,
    dto: UpdateCampaignDto,
    actor: ActorContext,
  ) {
    const campaign = await this.findCampaignOrFail(id, accountId);

    if (
      campaign.state !== CampaignState.DRAFT &&
      campaign.state !== CampaignState.QUOTED
    ) {
      throw new BadRequestException({
        error: {
          code: 'CAMPAIGN_NOT_EDITABLE',
          message: `A campanha esta no estado "${campaign.state}" e nao pode mais ser editada.`,
          details: { state: campaign.state },
        },
      });
    }

    this.validateBudget(dto.budget_amount);
    await this.validateTargetingNotTooNarrow(dto.audience_targeting);

    const editableFieldsTouched =
      dto.budget_amount !== undefined ||
      dto.audience_targeting !== undefined ||
      dto.message !== undefined ||
      dto.deliverable_formats !== undefined;

    if (dto.name !== undefined) campaign.name = dto.name;
    if (dto.budget_amount !== undefined) campaign.budgetAmount = dto.budget_amount;
    if (dto.budget_currency !== undefined) campaign.budgetCurrency = dto.budget_currency;
    if (dto.audience_targeting !== undefined) campaign.audienceTargeting = dto.audience_targeting;
    if (dto.message !== undefined) campaign.message = dto.message;
    if (dto.deliverable_formats !== undefined) campaign.deliverableFormats = dto.deliverable_formats;
    if (dto.timeline_start !== undefined)
      campaign.timelineStart = dto.timeline_start ? new Date(dto.timeline_start) : null;
    if (dto.timeline_end !== undefined)
      campaign.timelineEnd = dto.timeline_end ? new Date(dto.timeline_end) : null;

    // Editing a quoted campaign's core fields supersedes the quote and
    // reverts the campaign to draft, enforcing the "fresh quote" rule
    // structurally (architecture section 3.2, PATCH /campaigns/:id).
    if (campaign.state === CampaignState.QUOTED && editableFieldsTouched) {
      await this.quoteRepo.update(
        { campaignId: campaign.id, superseded: false },
        { superseded: true },
      );
      const fromState = campaign.state;
      campaign.state = CampaignState.DRAFT;
      await this.writeTransition(campaign.id, fromState, CampaignState.DRAFT, actor.userId);
    }

    campaign.missingFields = this.computeMissingFields(campaign).join(',');

    const saved = await this.campaignRepo.save(campaign);

    await this.auditService.log({
      actorUserId: actor.userId,
      targetAccountId: accountId,
      action: 'campaign.updated',
      metadata: { campaign_id: saved.id, updated_fields: Object.keys(dto) },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return this.formatCampaign(saved, await this.brandProfileStatus(accountId));
  }

  async findOne(id: string, accountId: string) {
    const campaign = await this.findCampaignOrFail(id, accountId);
    const latestQuote = await this.quoteRepo.findOne({
      where: { campaignId: id, superseded: false },
      order: { requestedAt: 'DESC' },
    });

    return {
      ...this.formatCampaign(campaign, await this.brandProfileStatus(accountId)),
      latest_quote: latestQuote ? this.formatQuote(latestQuote) : null,
    };
  }

  async list(
    accountId: string,
    state?: string,
    cursor?: string,
    limit = 20,
  ) {
    const qb = this.campaignRepo
      .createQueryBuilder('c')
      .where('c.accountId = :accountId', { accountId })
      .orderBy('c.createdAt', 'DESC')
      .limit(Math.min(limit, 100) + 1);

    if (state) {
      qb.andWhere('c.state = :state', { state });
    }
    if (cursor) {
      qb.andWhere('c.createdAt < (SELECT created_at FROM campaign WHERE id = :cursor)', {
        cursor,
      });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const data = rows.slice(0, limit).map((c) => ({
      id: c.id,
      name: c.name,
      state: c.state,
      budget_amount: c.budgetAmount,
      created_at: c.createdAt.toISOString(),
    }));

    return {
      data,
      pagination: {
        next_cursor: hasMore ? data[data.length - 1].id : null,
        has_more: hasMore,
      },
    };
  }

  // ---- Quote ----

  async requestQuote(id: string, accountId: string, actor: ActorContext) {
    const campaign = await this.findCampaignOrFail(id, accountId);

    if (campaign.state !== CampaignState.DRAFT) {
      throw new BadRequestException({
        error: {
          code: 'INVALID_STATE_TRANSITION',
          message: `Nao e possivel solicitar uma cotacao a partir do estado "${campaign.state}".`,
          details: { state: campaign.state },
        },
      });
    }

    if (campaign.brandProfileDrift && campaign.brandProfileDrift.length > 0) {
      throw new BadRequestException({
        error: {
          code: 'BRAND_PROFILE_DRIFT_UNRESOLVED',
          message:
            'Esta campanha foi criada a partir de um modelo com campos desatualizados em relacao ao perfil de marca. Confirme ou atualize-os antes de cotar.',
          details: { brand_profile_drift: campaign.brandProfileDrift },
        },
      });
    }

    const missing = this.computeMissingFields(campaign).filter((f) =>
      (QUOTE_REQUIRED_FIELDS as readonly string[]).includes(f),
    );
    if (missing.length > 0) {
      throw new BadRequestException({
        error: {
          code: 'CAMPAIGN_INCOMPLETE',
          message: 'A campanha esta incompleta e nao pode ser cotada ainda.',
          details: { missing_fields: missing },
        },
      });
    }

    const existingPending = await this.quoteRepo.findOne({
      where: { campaignId: id, status: CampaignQuoteStatus.PENDING },
    });
    if (existingPending) {
      throw new ConflictException({
        error: {
          code: 'QUOTE_ALREADY_PENDING',
          message: 'Ja existe uma cotacao em andamento para esta campanha.',
          details: { quote_id: existingPending.id },
        },
      });
    }

    const quote = this.quoteRepo.create({
      campaignId: id,
      status: CampaignQuoteStatus.PENDING,
    });
    const savedQuote = await this.quoteRepo.save(quote);

    await this.campaignQueue.add('compute-quote', {
      campaignId: id,
      quoteId: savedQuote.id,
    });

    await this.auditService.log({
      actorUserId: actor.userId,
      targetAccountId: accountId,
      action: 'campaign.quote_requested',
      metadata: { campaign_id: id, quote_id: savedQuote.id },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return {
      quote_id: savedQuote.id,
      status: savedQuote.status,
      poll_url: `/v1/campaigns/${id}/quote/${savedQuote.id}`,
    };
  }

  async getQuote(campaignId: string, quoteId: string, accountId: string) {
    await this.findCampaignOrFail(campaignId, accountId);
    const quote = await this.quoteRepo.findOne({
      where: { id: quoteId, campaignId },
    });
    if (!quote) {
      throw new NotFoundException({
        error: {
          code: 'QUOTE_NOT_FOUND',
          message: 'Cotacao nao encontrada.',
          details: {},
        },
      });
    }
    return this.formatQuote(quote);
  }

  // ---- Confirmation ----

  async confirm(id: string, accountId: string, actor: ActorContext) {
    const campaign = await this.findCampaignOrFail(id, accountId);

    if (campaign.state !== CampaignState.QUOTED) {
      throw new BadRequestException({
        error: {
          code: 'INVALID_STATE_TRANSITION',
          message: `Nao e possivel confirmar a partir do estado "${campaign.state}".`,
          details: { state: campaign.state },
        },
      });
    }

    const latestQuote = await this.quoteRepo.findOne({
      where: { campaignId: id, superseded: false },
      order: { requestedAt: 'DESC' },
    });

    if (!latestQuote || latestQuote.status !== CampaignQuoteStatus.READY) {
      throw new BadRequestException({
        error: {
          code: 'QUOTE_NOT_READY',
          message: 'Nao ha uma cotacao pronta para confirmar esta campanha.',
          details: {},
        },
      });
    }

    const fromState = campaign.state;
    campaign.state = CampaignState.CONFIRMED;
    campaign.lockedPrice = latestQuote.totalPrice;
    campaign.guaranteedMinPoolSize = latestQuote.guaranteedMinPoolSize;
    const saved = await this.campaignRepo.save(campaign);

    await this.writeTransition(id, fromState, CampaignState.CONFIRMED, actor.userId);

    const bounds = this.boundsRepo.create({
      campaignId: id,
      maxShiftPct: '20',
      minGuaranteedSharePct: '50',
      enabled: false,
    });
    await this.boundsRepo.save(bounds);

    await this.auditService.log({
      actorUserId: actor.userId,
      targetAccountId: accountId,
      action: 'campaign.confirmed',
      metadata: { campaign_id: id, locked_price: saved.lockedPrice },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    // Schedule the pool-fill-check job 24h before timeline_start (US-07 scenario 3).
    if (saved.timelineStart) {
      const delay = Math.max(
        0,
        new Date(saved.timelineStart).getTime() - Date.now() - 24 * 60 * 60 * 1000,
      );
      await this.campaignQueue.add(
        'pool-fill-check',
        { campaignId: id },
        { delay },
      );
    }

    return {
      id: saved.id,
      state: saved.state,
      locked_price: saved.lockedPrice,
      guaranteed_min_pool_size: saved.guaranteedMinPoolSize,
      confirmed_at: saved.updatedAt.toISOString(),
    };
  }

  // ---- Shortfall ----

  async getShortfall(id: string, accountId: string) {
    await this.findCampaignOrFail(id, accountId);
    const shortfall = await this.shortfallRepo.findOne({ where: { campaignId: id } });
    if (!shortfall) return { shortfall: null };
    return { shortfall: this.formatShortfall(shortfall) };
  }

  // Called internally (by the pool-fill-check job) when the actual matched
  // pool is short of the guaranteed minimum (ADR-0008).
  async recordShortfall(
    campaignId: string,
    guaranteedMinPoolSize: number,
    actualPoolSize: number,
    lockedPrice: string,
  ) {
    const shortfallPct =
      (guaranteedMinPoolSize - actualPoolSize) / guaranteedMinPoolSize;
    if (shortfallPct <= 0) return null;

    const choiceOffered = shortfallPct >= 0.15;
    const refundAmount = (parseFloat(lockedPrice) * shortfallPct).toFixed(2);

    const resolution = this.shortfallRepo.create({
      campaignId,
      resolutionType: ShortfallResolutionType.REVISED_GUARANTEE,
      refundAmount: choiceOffered ? refundAmount : null,
      revisedMinPoolSize: actualPoolSize,
      choiceOffered,
      chosenBy: ShortfallChosenBy.AURORA_DEFAULT,
    });
    return this.shortfallRepo.save(resolution);
  }

  async resolveShortfall(
    id: string,
    accountId: string,
    dto: ResolveShortfallDto,
    actor: ActorContext,
  ) {
    await this.findCampaignOrFail(id, accountId);
    const shortfall = await this.shortfallRepo.findOne({ where: { campaignId: id } });
    if (!shortfall) {
      throw new NotFoundException({
        error: {
          code: 'SHORTFALL_NOT_FOUND',
          message: 'Nao ha um shortfall registrado para esta campanha.',
          details: {},
        },
      });
    }

    // Small shortfalls only offer the default (revised_guarantee); per
    // ADR-0008, partial_refund is only a valid choice when choiceOffered is
    // true (shortfall >= 15%). Reject any resolution_type that was never
    // actually offered to the buyer.
    if (!shortfall.choiceOffered && dto.resolution_type !== 'revised_guarantee') {
      throw new BadRequestException({
        error: {
          code: 'RESOLUTION_TYPE_NOT_OFFERED',
          message:
            'O tipo de resolucao escolhido nao estava entre as opcoes oferecidas para este shortfall.',
          details: { resolution_type: dto.resolution_type },
        },
      });
    }

    shortfall.resolutionType = dto.resolution_type as ShortfallResolutionType;
    shortfall.chosenBy = ShortfallChosenBy.BUYER;
    shortfall.resolvedAt = new Date();
    const saved = await this.shortfallRepo.save(shortfall);

    await this.auditService.log({
      actorUserId: actor.userId,
      targetAccountId: accountId,
      action: 'campaign.shortfall_resolved',
      metadata: { campaign_id: id, resolution_type: saved.resolutionType },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    // Partial refund execution is handed off to E6's payment module; E2 only
    // records the obligation amount.
    if (saved.resolutionType === ShortfallResolutionType.PARTIAL_REFUND) {
      await this.campaignQueue.add('refund-requested', {
        campaignId: id,
        refundAmount: saved.refundAmount,
      });
    }

    return {
      id: saved.id,
      resolution_type: saved.resolutionType,
      revised_min_pool_size: saved.revisedMinPoolSize,
      resolved_at: saved.resolvedAt!.toISOString(),
    };
  }

  // ---- Lifecycle ----

  async pause(id: string, accountId: string, dto: LifecycleActionDto, actor: ActorContext) {
    const campaign = await this.findCampaignOrFail(id, accountId);
    if (campaign.state !== CampaignState.ACTIVE) {
      throw this.invalidTransition(campaign.state, 'pausar');
    }

    const fromState = campaign.state;
    campaign.state = CampaignState.PAUSED;
    const saved = await this.campaignRepo.save(campaign);
    await this.writeTransition(id, fromState, CampaignState.PAUSED, actor.userId, dto.reason || null);

    await this.auditService.log({
      actorUserId: actor.userId,
      targetAccountId: accountId,
      action: 'campaign.paused',
      metadata: { campaign_id: id, reason: dto.reason || null },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    // E2 only owns campaign state; halting publications and notifying
    // creators is handled by E5's content workflow listening to this event.
    await this.campaignQueue.add('campaign-paused-notify', { campaignId: id });

    return { id: saved.id, state: saved.state, paused_at: saved.updatedAt.toISOString() };
  }

  async resume(id: string, accountId: string, actor: ActorContext) {
    const campaign = await this.findCampaignOrFail(id, accountId);
    if (campaign.state !== CampaignState.PAUSED) {
      throw this.invalidTransition(campaign.state, 'retomar');
    }

    const fromState = campaign.state;
    campaign.state = CampaignState.ACTIVE;
    const saved = await this.campaignRepo.save(campaign);
    await this.writeTransition(id, fromState, CampaignState.ACTIVE, actor.userId);

    await this.auditService.log({
      actorUserId: actor.userId,
      targetAccountId: accountId,
      action: 'campaign.resumed',
      metadata: { campaign_id: id },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    await this.campaignQueue.add('campaign-resumed-notify', { campaignId: id });

    return { id: saved.id, state: saved.state, resumed_at: saved.updatedAt.toISOString() };
  }

  async cancel(id: string, accountId: string, dto: LifecycleActionDto, actor: ActorContext) {
    const campaign = await this.findCampaignOrFail(id, accountId);
    const cancellableFrom = [
      CampaignState.ACTIVE,
      CampaignState.PAUSED,
      CampaignState.CONFIRMED,
    ];
    if (!cancellableFrom.includes(campaign.state)) {
      throw this.invalidTransition(campaign.state, 'cancelar');
    }

    const fromState = campaign.state;
    campaign.state = CampaignState.CANCELLED;
    const saved = await this.campaignRepo.save(campaign);
    await this.writeTransition(id, fromState, CampaignState.CANCELLED, actor.userId, dto.reason || null);

    await this.auditService.log({
      actorUserId: actor.userId,
      targetAccountId: accountId,
      action: 'campaign.cancelled',
      metadata: { campaign_id: id, reason: dto.reason || null },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    await this.campaignQueue.add('campaign-cancelled-notify', { campaignId: id });

    return { id: saved.id, state: saved.state, cancelled_at: saved.updatedAt.toISOString() };
  }

  private invalidTransition(currentState: string, attemptedAction: string) {
    return new BadRequestException({
      error: {
        code: 'INVALID_STATE_TRANSITION',
        message: `Nao e possivel ${attemptedAction} a partir do estado "${currentState}".`,
        details: { state: currentState },
      },
    });
  }

  // ---- Reallocation bounds ----

  async setReallocationBounds(
    id: string,
    accountId: string,
    dto: ReallocationBoundsDto,
    actor: ActorContext,
  ) {
    await this.findCampaignOrFail(id, accountId);

    let bounds = await this.boundsRepo.findOne({ where: { campaignId: id } });
    if (!bounds) {
      bounds = this.boundsRepo.create({ campaignId: id });
    }
    bounds.enabled = dto.enabled;
    bounds.maxShiftPct = String(dto.max_shift_pct);
    bounds.minGuaranteedSharePct = String(dto.min_guaranteed_share_pct);
    const saved = await this.boundsRepo.save(bounds);

    await this.auditService.log({
      actorUserId: actor.userId,
      targetAccountId: accountId,
      action: 'campaign.reallocation_bounds_updated',
      metadata: { campaign_id: id, enabled: saved.enabled },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return {
      enabled: saved.enabled,
      max_shift_pct: Number(saved.maxShiftPct),
      min_guaranteed_share_pct: Number(saved.minGuaranteedSharePct),
    };
  }

  async listReallocationEvents(id: string, accountId: string) {
    await this.findCampaignOrFail(id, accountId);
    const events = await this.reallocationEventRepo.find({
      where: { campaignId: id },
      order: { createdAt: 'DESC' },
    });
    return {
      data: events.map((e) => ({
        id: e.id,
        trigger: e.trigger,
        outcome: e.outcome,
        before_allocations: e.beforeAllocations,
        after_allocations: e.afterAllocations,
        created_at: e.createdAt.toISOString(),
      })),
      pagination: { next_cursor: null, has_more: false },
    };
  }

  // ---- Helpers ----

  async findCampaignOrFail(id: string, accountId: string): Promise<Campaign> {
    const campaign = await this.campaignRepo.findOne({ where: { id, accountId } });
    if (!campaign) {
      throw new NotFoundException({
        error: {
          code: 'CAMPAIGN_NOT_FOUND',
          message: 'Campanha nao encontrada.',
          details: {},
        },
      });
    }
    return campaign;
  }

  private async brandProfileStatus(accountId: string): Promise<string> {
    const profile = await this.brandProfileRepo.findOne({ where: { accountId } });
    return profile?.status || 'draft';
  }

  formatCampaign(campaign: Campaign, brandProfileStatus: string) {
    return {
      id: campaign.id,
      account_id: campaign.accountId,
      template_id: campaign.templateId,
      name: campaign.name,
      state: campaign.state,
      budget_amount: campaign.budgetAmount,
      budget_currency: campaign.budgetCurrency,
      audience_targeting: campaign.audienceTargeting,
      message: campaign.message,
      deliverable_formats: campaign.deliverableFormats,
      timeline_start: campaign.timelineStart?.toISOString() || null,
      timeline_end: campaign.timelineEnd?.toISOString() || null,
      missing_fields: campaign.missingFields
        ? campaign.missingFields.split(',').filter(Boolean)
        : [],
      brand_profile_status: brandProfileStatus,
      brand_profile_drift: campaign.brandProfileDrift || [],
      created_at: campaign.createdAt.toISOString(),
      updated_at: campaign.updatedAt.toISOString(),
    };
  }

  private formatQuote(quote: CampaignQuote) {
    return {
      id: quote.id,
      status: quote.status,
      guaranteed_min_pool_size: quote.guaranteedMinPoolSize,
      projected_reach_low: quote.projectedReachLow,
      projected_reach_high: quote.projectedReachHigh,
      total_price: quote.totalPrice,
      failure_reason: quote.failureReason,
      requested_at: quote.requestedAt.toISOString(),
      resolved_at: quote.resolvedAt?.toISOString() || null,
    };
  }

  private formatShortfall(shortfall: PoolShortfallResolution) {
    return {
      id: shortfall.id,
      resolution_type: shortfall.resolutionType,
      refund_amount: shortfall.refundAmount,
      revised_min_pool_size: shortfall.revisedMinPoolSize,
      choice_offered: shortfall.choiceOffered,
      chosen_by: shortfall.chosenBy,
      notified_at: shortfall.notifiedAt.toISOString(),
      resolved_at: shortfall.resolvedAt?.toISOString() || null,
    };
  }
}
