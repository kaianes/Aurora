import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Repository } from 'typeorm';
import {
  Campaign,
  CampaignState,
  CampaignShortlist,
  ShortlistStatus,
  ShortlistLockedReason,
  CampaignShortlistEntry,
  ShortlistEntryOrigin,
  ShortlistEntryDecision,
  CampaignPoolMember,
  CreatorStatus,
  CreatorOnboardingStatus,
  Creator,
  AdditionalCandidatesRequest,
  Membership,
  OperatorClientAccess,
  Account,
  WorkspaceType,
  Role,
  CampaignOpportunity,
} from '../database/entities';
import { AuditService } from '../audit/audit.service';
import { ExclusionService } from './exclusion.service';
import { DecisionDto } from './dto/decision.dto';
import { BulkDecisionDto } from './dto/bulk-decision.dto';
import { OverrideShortlistDto } from './dto/override-shortlist.dto';

interface ActorContext {
  userId: string;
  ipAddress: string;
  userAgent: string;
}

// Pilot placeholders: the actual commission model and opportunity expiry
// window belong to E6 (payments) and are out of E3's scope. E3 only stores
// the figures it was given at opportunity-creation time (section 2.2 of the
// E3 architecture doc, CAMPAIGN_OPPORTUNITY description).
const PILOT_COMMISSION_RATE = 0.15;
const OPPORTUNITY_EXPIRY_HOURS = 72;

const CAMPAIGN_READY_STATES = [
  CampaignState.CONFIRMED,
  CampaignState.ACTIVE,
  CampaignState.PAUSED,
  CampaignState.COMPLETED,
];

@Injectable()
export class ShortlistService {
  constructor(
    @InjectRepository(Campaign)
    private campaignRepo: Repository<Campaign>,
    @InjectRepository(CampaignShortlist)
    private shortlistRepo: Repository<CampaignShortlist>,
    @InjectRepository(CampaignShortlistEntry)
    private entryRepo: Repository<CampaignShortlistEntry>,
    @InjectRepository(CampaignPoolMember)
    private poolMemberRepo: Repository<CampaignPoolMember>,
    @InjectRepository(Creator)
    private creatorRepo: Repository<Creator>,
    @InjectRepository(AdditionalCandidatesRequest)
    private requestRepo: Repository<AdditionalCandidatesRequest>,
    @InjectRepository(Membership)
    private membershipRepo: Repository<Membership>,
    @InjectRepository(OperatorClientAccess)
    private operatorAccessRepo: Repository<OperatorClientAccess>,
    @InjectRepository(Account)
    private accountRepo: Repository<Account>,
    @InjectRepository(CampaignOpportunity)
    private opportunityRepo: Repository<CampaignOpportunity>,
    @InjectQueue('matching')
    private matchingQueue: Queue,
    private exclusionService: ExclusionService,
    private auditService: AuditService,
  ) {}

  // ---- US-11: request/poll ----

  async requestShortlist(campaignId: string, accountId: string, actor: ActorContext) {
    const campaign = await this.findCampaignOrFail(campaignId, accountId);

    if (!CAMPAIGN_READY_STATES.includes(campaign.state)) {
      throw new BadRequestException({
        error: {
          code: 'CAMPAIGN_NOT_READY',
          message: `Nao e possivel gerar shortlist a partir do estado "${campaign.state}".`,
          details: { state: campaign.state },
        },
      });
    }

    let shortlist = await this.shortlistRepo.findOne({ where: { campaignId } });
    if (shortlist?.locked) {
      throw new ConflictException({
        error: {
          code: 'SHORTLIST_LOCKED',
          message:
            'O shortlist desta campanha ja esta travado. Novas mudancas devem passar pelos controles da campanha.',
          details: { locked_reason: shortlist.lockedReason },
        },
      });
    }

    if (shortlist) {
      // Regenerating: replace entries and reset status (section 2.6 of the
      // E3 architecture doc -- no second campaign_shortlist row is created).
      await this.entryRepo.delete({ shortlistId: shortlist.id });
      shortlist.status = ShortlistStatus.PENDING;
      shortlist.failureReason = null;
      shortlist.belowGuaranteedMinimum = false;
      shortlist.resolvedAt = null;
      shortlist = await this.shortlistRepo.save(shortlist);
    } else {
      shortlist = await this.shortlistRepo.save(
        this.shortlistRepo.create({ campaignId, status: ShortlistStatus.PENDING }),
      );
    }

    await this.matchingQueue.add('generate-shortlist', {
      campaignId,
      shortlistId: shortlist.id,
    });

    await this.auditService.log({
      actorUserId: actor.userId,
      targetAccountId: accountId,
      action: 'shortlist.requested',
      metadata: { campaign_id: campaignId, shortlist_id: shortlist.id },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return {
      shortlist_id: shortlist.id,
      status: shortlist.status,
      poll_url: `/v1/campaigns/${campaignId}/shortlist`,
    };
  }

  async getShortlist(campaignId: string, accountId: string) {
    await this.findCampaignOrFail(campaignId, accountId);
    const shortlist = await this.shortlistRepo.findOne({ where: { campaignId } });
    if (!shortlist) {
      throw new NotFoundException({
        error: {
          error: 'SHORTLIST_NOT_FOUND',
          code: 'SHORTLIST_NOT_FOUND',
          message: 'Nenhum shortlist foi solicitado para esta campanha ainda.',
          details: {},
        },
      });
    }

    const entries = await this.entryRepo.find({
      where: { shortlistId: shortlist.id },
      order: { rank: 'ASC', createdAt: 'ASC' },
    });

    const campaign = await this.campaignRepo.findOne({ where: { id: campaignId } });
    const response: Record<string, any> = this.formatShortlist(shortlist, entries);

    if (shortlist.belowGuaranteedMinimum && campaign?.guaranteedMinPoolSize) {
      response.guaranteed_min_pool_size = campaign.guaranteedMinPoolSize;
      response.matched_count = this.countIncludedNonRejected(entries);
    }

    return response;
  }

  // ---- US-13: approve/reject ----

  async decideEntry(
    campaignId: string,
    entryId: string,
    accountId: string,
    dto: DecisionDto,
    actor: ActorContext,
  ) {
    const campaign = await this.findCampaignOrFail(campaignId, accountId);
    const shortlist = await this.getShortlistOrFail(campaignId);
    this.assertNotLockedForDecisions(shortlist);

    const entry = await this.entryRepo.findOne({ where: { id: entryId, campaignId } });
    if (!entry) {
      throw new NotFoundException({
        error: { code: 'SHORTLIST_ENTRY_NOT_FOUND', message: 'Entrada nao encontrada.', details: {} },
      });
    }

    this.applyDecision(entry, dto.decision, actor.userId);
    await this.entryRepo.save(entry);

    const warning = await this.recomputeBelowMinimum(shortlist, campaign);

    await this.auditService.log({
      actorUserId: actor.userId,
      targetAccountId: accountId,
      action: entry.decision === ShortlistEntryDecision.APPROVED
        ? 'shortlist_entry.approved'
        : 'shortlist_entry.rejected',
      metadata: { campaign_id: campaignId, entry_id: entry.id },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    const response: Record<string, any> = {
      id: entry.id,
      decision: entry.decision,
      included: entry.included,
      decision_at: entry.decisionAt?.toISOString() || null,
    };
    if (warning) response.warning = warning;
    return response;
  }

  async bulkDecide(
    campaignId: string,
    accountId: string,
    dto: BulkDecisionDto,
    actor: ActorContext,
  ) {
    const campaign = await this.findCampaignOrFail(campaignId, accountId);
    const shortlist = await this.getShortlistOrFail(campaignId);
    this.assertNotLockedForDecisions(shortlist);

    const entries = await this.entryRepo.find({
      where: { campaignId },
    });
    const byId = new Map(entries.map((e) => [e.id, e]));

    const missing = dto.decisions.filter((d) => !byId.has(d.entry_id));
    if (missing.length > 0) {
      throw new NotFoundException({
        error: {
          code: 'SHORTLIST_ENTRY_NOT_FOUND',
          message: 'Uma ou mais entradas informadas nao foram encontradas.',
          details: { entry_ids: missing.map((m) => m.entry_id) },
        },
      });
    }

    const touched: CampaignShortlistEntry[] = [];
    for (const d of dto.decisions) {
      const entry = byId.get(d.entry_id)!;
      this.applyDecision(entry, d.decision, actor.userId);
      touched.push(entry);
    }
    await this.entryRepo.save(touched);

    const warning = await this.recomputeBelowMinimum(shortlist, campaign);

    await this.auditService.log({
      actorUserId: actor.userId,
      targetAccountId: accountId,
      action: 'shortlist_entries.bulk_decision',
      metadata: { campaign_id: campaignId, decisions: dto.decisions },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    const response: Record<string, any> = {
      data: touched.map((e) => ({
        id: e.id,
        decision: e.decision,
        included: e.included,
        decision_at: e.decisionAt?.toISOString() || null,
      })),
    };
    if (warning) response.warning = warning;
    return response;
  }

  // ---- US-13 scenario 2 / ADR-0018: top-up ----

  async requestAdditionalCandidates(campaignId: string, accountId: string, actor: ActorContext) {
    const campaign = await this.findCampaignOrFail(campaignId, accountId);
    const shortlist = await this.getShortlistOrFail(campaignId);

    if (shortlist.locked) {
      throw new ConflictException({
        error: {
          code: 'SHORTLIST_LOCKED',
          message: 'O shortlist desta campanha ja esta travado.',
          details: {},
        },
      });
    }
    if (!shortlist.belowGuaranteedMinimum) {
      throw new BadRequestException({
        error: {
          code: 'POOL_NOT_BELOW_MINIMUM',
          message: 'O shortlist atual ja atende ao minimo garantido; nao ha necessidade de candidatos adicionais.',
          details: {},
        },
      });
    }

    const entries = await this.entryRepo.find({ where: { shortlistId: shortlist.id } });
    const includedCount = this.countIncludedNonRejected(entries);
    const shortfall = Math.max(1, (campaign.guaranteedMinPoolSize || 0) - includedCount);

    const request = await this.requestRepo.save(
      this.requestRepo.create({
        campaignId,
        shortlistId: shortlist.id,
        requestedCount: shortfall,
        requestedByUserId: actor.userId,
      }),
    );

    await this.matchingQueue.add('top-up-shortlist', {
      campaignId,
      shortlistId: shortlist.id,
      requestId: request.id,
    });

    await this.auditService.log({
      actorUserId: actor.userId,
      targetAccountId: accountId,
      action: 'shortlist.additional_candidates_requested',
      metadata: { campaign_id: campaignId, request_id: request.id, requested_count: shortfall },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return { request_id: request.id, status: request.status };
  }

  // ---- US-40: agency override ----

  async overrideShortlist(
    campaignId: string,
    accountId: string,
    currentRole: Role,
    userId: string,
    dto: OverrideShortlistDto,
    actor: ActorContext,
  ) {
    const account = await this.accountRepo.findOne({
      where: { id: accountId },
      relations: { workspace: true },
    });
    if (!account || account.workspace.type !== WorkspaceType.AGENCY) {
      throw new ForbiddenException({
        error: {
          code: 'NOT_AGENCY_CONTEXT',
          message: 'Esta conta nao e uma conta de cliente de agencia.',
          details: {},
        },
      });
    }

    // NFR-16: an agency_operator may only override shortlists for client
    // accounts they have been explicitly granted access to.
    if (currentRole === Role.AGENCY_OPERATOR) {
      const membership = await this.membershipRepo.findOne({ where: { userId, accountId } });
      const access = membership
        ? await this.operatorAccessRepo.findOne({
            where: { membershipId: membership.id, accountId },
          })
        : null;
      if (!access) {
        throw new ForbiddenException({
          error: {
            code: 'NOT_AGENCY_CONTEXT',
            message: 'Voce nao tem acesso de operador a esta conta de cliente.',
            details: {},
          },
        });
      }
    }

    const campaign = await this.findCampaignOrFail(campaignId, accountId);
    const shortlist = await this.shortlistRepo.findOne({ where: { campaignId } });
    if (!shortlist || shortlist.status !== ShortlistStatus.READY) {
      throw new BadRequestException({
        error: {
          code: 'SHORTLIST_NOT_READY',
          message: 'O shortlist precisa estar pronto antes de ser sobrescrito.',
          details: {},
        },
      });
    }
    if (shortlist.locked) {
      throw new ConflictException({
        error: {
          code: 'SHORTLIST_ALREADY_LOCKED',
          message: 'O shortlist ja foi travado e nao pode ser sobrescrito novamente.',
          details: { locked_reason: shortlist.lockedReason },
        },
      });
    }

    const entries = await this.entryRepo.find({ where: { shortlistId: shortlist.id } });
    const entryById = new Map(entries.map((e) => [e.id, e]));
    const beforeSnapshot = entries.map((e) => this.formatEntry(e));

    const removeIds = dto.remove_entry_ids || [];
    const toSave: CampaignShortlistEntry[] = [];
    for (const id of removeIds) {
      const entry = entryById.get(id);
      if (entry) {
        entry.included = false;
        toSave.push(entry);
      }
    }

    const excludedCreatorIds = new Set(
      await this.exclusionService.resolveExcludedCreatorIds(accountId, campaignId),
    );
    const existingCreatorIds = new Set(entries.map((e) => e.creatorId));

    const addCreators = dto.add_creators || [];
    for (const item of addCreators) {
      if (excludedCreatorIds.has(item.creator_id)) {
        throw new UnprocessableEntityException({
          error: {
            code: 'CREATOR_EXCLUDED',
            message: `O criador ${item.creator_id} esta na lista de exclusao desta conta ou campanha.`,
            details: { creator_id: item.creator_id },
          },
        });
      }
      if (existingCreatorIds.has(item.creator_id)) {
        continue; // already on the shortlist, idempotent no-op
      }

      const creator = await this.creatorRepo.findOne({ where: { id: item.creator_id } });
      if (!creator) {
        throw new UnprocessableEntityException({
          error: {
            code: 'CREATOR_NOT_ELIGIBLE',
            message: `O criador ${item.creator_id} nao possui perfil na Aurora.`,
            details: { creator_id: item.creator_id, suggested_action: 'invite' },
          },
        });
      }
      if (
        creator.status !== CreatorStatus.ACTIVE ||
        creator.onboardingStatus !== CreatorOnboardingStatus.QUALIFIED
      ) {
        throw new UnprocessableEntityException({
          error: {
            code: 'CREATOR_NOT_ELIGIBLE',
            message: `O criador ${item.creator_id} ainda nao completou a qualificacao de onboarding.`,
            details: { creator_id: item.creator_id, suggested_action: 'wait_for_onboarding' },
          },
        });
      }

      const newEntry = this.entryRepo.create({
        shortlistId: shortlist.id,
        campaignId,
        creatorId: creator.id,
        rank: null,
        fitScore: null,
        matchedAttributes: null,
        origin: ShortlistEntryOrigin.AGENCY_ADDED,
        decision: ShortlistEntryDecision.APPROVED,
        decisionByUserId: userId,
        decisionAt: new Date(),
        included: true,
        addedByUserId: userId,
      });
      toSave.push(newEntry);
      existingCreatorIds.add(creator.id);
    }

    const savedEntries = await this.entryRepo.save(toSave);

    shortlist.locked = true;
    shortlist.lockedReason = ShortlistLockedReason.AGENCY_OVERRIDE;
    shortlist.lockedAt = new Date();
    await this.recomputeBelowMinimum(shortlist, campaign, savedEntries);
    const savedShortlist = await this.shortlistRepo.save(shortlist);

    // ADR-0012: the locked shortlist is handed off to campaign_pool_member
    // once, here; campaign/payment code never reads matching's tables again.
    await this.lockAndHandoff(savedShortlist.id, campaignId, campaign.lockedPrice);

    const finalEntries = await this.entryRepo.find({ where: { shortlistId: shortlist.id } });

    await this.auditService.log({
      actorUserId: actor.userId,
      targetAccountId: accountId,
      action: 'shortlist.agency_overridden',
      metadata: {
        campaign_id: campaignId,
        shortlist_id: shortlist.id,
        before: beforeSnapshot,
        after: finalEntries.map((e) => this.formatEntry(e)),
      },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return this.formatShortlist(savedShortlist, finalEntries);
  }

  // ---- ADR-0012: one-time hand-off to campaign_pool_member ----

  async lockAndHandoff(shortlistId: string, campaignId: string, lockedPrice: string | null) {
    const entries = await this.entryRepo.find({ where: { shortlistId, included: true } });
    if (entries.length === 0) return;

    const price = parseFloat(lockedPrice || '0');
    const perCreator = (price / entries.length).toFixed(2);

    const members = entries.map((e) =>
      this.poolMemberRepo.create({
        campaignId,
        creatorId: e.creatorId,
        allocatedBudget: perCreator,
        originalBudget: perCreator,
      }),
    );

    // Idempotent: a repeated hand-off (should not normally happen once
    // locked) does not duplicate pool members for the same creator.
    const existing = await this.poolMemberRepo.find({ where: { campaignId } });
    const existingCreatorIds = new Set(existing.map((m) => m.creatorId));
    const toInsert = members.filter((m) => !existingCreatorIds.has(m.creatorId));
    if (toInsert.length > 0) {
      await this.poolMemberRepo.save(toInsert);
    }

    await this.createOpportunities(entries, campaignId, perCreator);
  }

  // US-28: created only for entries with included = true and decision =
  // approved (agency_added entries are implicitly approved by the override
  // flow itself). Idempotent on (campaign_id, creator_id) per uq_opportunity.
  private async createOpportunities(
    entries: CampaignShortlistEntry[],
    campaignId: string,
    perCreatorGross: string,
  ) {
    const approved = entries.filter(
      (e) => e.included && e.decision === ShortlistEntryDecision.APPROVED,
    );
    if (approved.length === 0) return;

    const existing = await this.opportunityRepo.find({ where: { campaignId } });
    const existingCreatorIds = new Set(existing.map((o) => o.creatorId));

    const gross = parseFloat(perCreatorGross);
    const commission = gross * PILOT_COMMISSION_RATE;
    const net = gross - commission;
    const expiresAt = new Date(Date.now() + OPPORTUNITY_EXPIRY_HOURS * 60 * 60 * 1000);

    const toCreate = approved
      .filter((e) => !existingCreatorIds.has(e.creatorId))
      .map((e) =>
        this.opportunityRepo.create({
          campaignId,
          creatorId: e.creatorId,
          shortlistEntryId: e.id,
          deliverable: { format: 'instagram_reel', quantity: 1 },
          payoutGross: gross.toFixed(2),
          payoutCommission: commission.toFixed(2),
          payoutNet: net.toFixed(2),
          expiresAt,
        }),
      );

    if (toCreate.length > 0) {
      await this.opportunityRepo.save(toCreate);
    }
  }

  // ---- Shared helpers ----

  async findCampaignOrFail(id: string, accountId: string): Promise<Campaign> {
    const campaign = await this.campaignRepo.findOne({ where: { id, accountId } });
    if (!campaign) {
      throw new NotFoundException({
        error: { code: 'CAMPAIGN_NOT_FOUND', message: 'Campanha nao encontrada.', details: {} },
      });
    }
    return campaign;
  }

  private async getShortlistOrFail(campaignId: string): Promise<CampaignShortlist> {
    const shortlist = await this.shortlistRepo.findOne({ where: { campaignId } });
    if (!shortlist) {
      throw new NotFoundException({
        error: { code: 'SHORTLIST_NOT_FOUND', message: 'Shortlist nao encontrado.', details: {} },
      });
    }
    return shortlist;
  }

  private assertNotLockedForDecisions(shortlist: CampaignShortlist) {
    if (shortlist.locked) {
      throw new BadRequestException({
        error: {
          code: 'SHORTLIST_LOCKED_FOR_DECISIONS',
          message:
            'As decisoes do shortlist estao congeladas porque a campanha esta ativa ou o shortlist foi sobrescrito. Use os controles da campanha (pausar/retomar) para novas mudancas.',
          details: { locked_reason: shortlist.lockedReason },
        },
      });
    }
  }

  private applyDecision(
    entry: CampaignShortlistEntry,
    decision: 'approved' | 'rejected',
    userId: string,
  ) {
    entry.decision =
      decision === 'approved' ? ShortlistEntryDecision.APPROVED : ShortlistEntryDecision.REJECTED;
    entry.decisionByUserId = userId;
    entry.decisionAt = new Date();
    if (decision === 'rejected') {
      entry.included = false;
    }
  }

  private countIncludedNonRejected(entries: CampaignShortlistEntry[]): number {
    return entries.filter(
      (e) => e.included && e.decision !== ShortlistEntryDecision.REJECTED,
    ).length;
  }

  // US-13 scenario 2: recomputes below_guaranteed_minimum and returns a
  // warning token for the response when the pool just dropped below it.
  private async recomputeBelowMinimum(
    shortlist: CampaignShortlist,
    campaign: Campaign,
    knownEntries?: CampaignShortlistEntry[],
  ): Promise<string | null> {
    const entries =
      knownEntries || (await this.entryRepo.find({ where: { shortlistId: shortlist.id } }));
    const includedCount = this.countIncludedNonRejected(entries);
    const min = campaign.guaranteedMinPoolSize || 0;
    const isBelow = min > 0 && includedCount < min;

    shortlist.belowGuaranteedMinimum = isBelow;
    await this.shortlistRepo.save(shortlist);

    return isBelow ? 'pool_below_guaranteed_minimum' : null;
  }

  formatShortlist(shortlist: CampaignShortlist, entries: CampaignShortlistEntry[]) {
    return {
      id: shortlist.id,
      campaign_id: shortlist.campaignId,
      status: shortlist.status,
      failure_reason: shortlist.failureReason,
      below_guaranteed_minimum: shortlist.belowGuaranteedMinimum,
      locked: shortlist.locked,
      locked_reason: shortlist.lockedReason,
      locked_at: shortlist.lockedAt?.toISOString() || null,
      entries: entries.map((e) => this.formatEntry(e)),
      requested_at: shortlist.requestedAt.toISOString(),
      resolved_at: shortlist.resolvedAt?.toISOString() || null,
    };
  }

  private formatEntry(entry: CampaignShortlistEntry) {
    return {
      id: entry.id,
      creator_id: entry.creatorId,
      rank: entry.rank,
      fit_score: entry.fitScore !== null ? Number(entry.fitScore) : null,
      matched_attributes: entry.matchedAttributes || [],
      origin: entry.origin,
      decision: entry.decision,
      included: entry.included,
    };
  }
}
