import { Injectable, NotFoundException, GoneException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  CampaignOpportunity,
  OpportunityStatus,
  CampaignShortlistEntry,
  Campaign,
  Account,
  CampaignPoolMember,
  PoolMemberStatus,
} from '../database/entities';
import { AuditService } from '../audit/audit.service';

interface ActorContext {
  ipAddress: string;
  userAgent: string;
}

@Injectable()
export class OpportunityService {
  constructor(
    @InjectRepository(CampaignOpportunity)
    private opportunityRepo: Repository<CampaignOpportunity>,
    @InjectRepository(CampaignShortlistEntry)
    private entryRepo: Repository<CampaignShortlistEntry>,
    @InjectRepository(Campaign)
    private campaignRepo: Repository<Campaign>,
    @InjectRepository(Account)
    private accountRepo: Repository<Account>,
    @InjectRepository(CampaignPoolMember)
    private poolMemberRepo: Repository<CampaignPoolMember>,
    private auditService: AuditService,
  ) {}

  // ADR-0012: removal from the shortlist's included set must also remove the
  // creator from campaign_pool_member, so campaign's pool-fill-check job
  // (which counts non-excluded pool members) can detect a post-lock shortfall.
  private async excludeFromPool(campaignId: string, creatorId: string) {
    await this.poolMemberRepo.update(
      { campaignId, creatorId },
      { status: PoolMemberStatus.EXCLUDED },
    );
  }

  async listForCreator(creatorId: string) {
    const opportunities = await this.opportunityRepo.find({
      where: { creatorId },
      order: { createdAt: 'DESC' },
    });

    const data = await Promise.all(
      opportunities.map(async (o) => {
        const campaign = await this.campaignRepo.findOne({ where: { id: o.campaignId } });
        const account = campaign
          ? await this.accountRepo.findOne({ where: { id: campaign.accountId } })
          : null;
        return this.format(o, account?.name || null);
      }),
    );

    return { data };
  }

  async accept(id: string, creatorId: string, actor: ActorContext) {
    const opportunity = await this.findOwnOrFail(id, creatorId);

    // Defensive check against races with the expire-opportunities cron
    // (US-28 scenario 3): never create a payout obligation past expiry.
    if (opportunity.status !== OpportunityStatus.PENDING) {
      if (opportunity.status === OpportunityStatus.EXPIRED) {
        throw new GoneException({
          error: {
            code: 'OPPORTUNITY_EXPIRED',
            message: 'Esta oportunidade expirou e nao esta mais disponivel.',
            details: {},
          },
        });
      }
      return this.format(opportunity, null);
    }
    if (new Date() >= opportunity.expiresAt) {
      opportunity.status = OpportunityStatus.EXPIRED;
      await this.opportunityRepo.save(opportunity);
      throw new GoneException({
        error: {
          code: 'OPPORTUNITY_EXPIRED',
          message: 'Esta oportunidade expirou e nao esta mais disponivel.',
          details: {},
        },
      });
    }

    opportunity.status = OpportunityStatus.ACCEPTED;
    opportunity.respondedAt = new Date();
    const saved = await this.opportunityRepo.save(opportunity);

    // ADR-0015: an override removing this creator does not retroactively
    // revoke an acceptance already made in good faith.
    const entry = await this.entryRepo.findOne({ where: { id: saved.shortlistEntryId } });
    const poolChanged = !!entry && !entry.included;

    await this.auditService.log({
      actorUserId: null,
      targetAccountId: null,
      action: 'opportunity.accepted',
      metadata: { opportunity_id: saved.id, creator_id: creatorId, campaign_id: saved.campaignId },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    const response = this.format(saved, null);
    if (poolChanged) {
      response.note =
        'O shortlist final desta campanha mudou desde que esta oportunidade foi enviada.';
    }
    return response;
  }

  async decline(id: string, creatorId: string, actor: ActorContext) {
    const opportunity = await this.findOwnOrFail(id, creatorId);

    if (opportunity.status !== OpportunityStatus.PENDING) {
      return this.format(opportunity, null);
    }

    opportunity.status = OpportunityStatus.DECLINED;
    opportunity.respondedAt = new Date();
    const saved = await this.opportunityRepo.save(opportunity);

    // Removes the creator from the active pool for this campaign (US-28
    // scenario 2). decision stays untouched -- the buyer's approval and the
    // creator's own choice are separate facts.
    await this.entryRepo.update({ id: saved.shortlistEntryId }, { included: false });
    await this.excludeFromPool(saved.campaignId, creatorId);

    await this.auditService.log({
      actorUserId: null,
      targetAccountId: null,
      action: 'opportunity.declined',
      metadata: { opportunity_id: saved.id, creator_id: creatorId, campaign_id: saved.campaignId },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return this.format(saved, null);
  }

  private async findOwnOrFail(id: string, creatorId: string): Promise<CampaignOpportunity> {
    // Every creator-portal endpoint checks creator_id from the JWT against
    // the resource's creator_id column directly (section 2.3 of the E3
    // architecture doc) -- there is no account-based tenant boundary here.
    const opportunity = await this.opportunityRepo.findOne({ where: { id, creatorId } });
    if (!opportunity) {
      throw new NotFoundException({
        error: { code: 'OPPORTUNITY_NOT_FOUND', message: 'Oportunidade nao encontrada.', details: {} },
      });
    }
    return opportunity;
  }

  private format(opportunity: CampaignOpportunity, brandName: string | null) {
    return {
      id: opportunity.id,
      campaign_id: opportunity.campaignId,
      brand_name: brandName,
      deliverable: opportunity.deliverable,
      payout_gross: opportunity.payoutGross,
      payout_commission: opportunity.payoutCommission,
      payout_net: opportunity.payoutNet,
      expires_at: opportunity.expiresAt.toISOString(),
      status: opportunity.status,
      responded_at: opportunity.respondedAt?.toISOString() || null,
    } as Record<string, any>;
  }
}
