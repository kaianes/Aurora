import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Repository } from 'typeorm';
import {
  Briefing,
  BriefingStatus,
  BriefingDistributionRecipient,
  DistributionRecipientStatus,
  Campaign,
  CampaignOpportunity,
} from '../database/entities';
import { AuditService } from '../audit/audit.service';
import { UpsertBriefingDto } from './dto/upsert-briefing.dto';

interface ActorContext {
  userId: string;
  ipAddress: string;
  userAgent: string;
  correlationId?: string;
}

// US-18a (compose) and US-18b (distribute in the same issue action), per
// section 4.2 of the E5 architecture doc.
@Injectable()
export class BriefingService {
  constructor(
    @InjectRepository(Campaign)
    private campaignRepo: Repository<Campaign>,
    @InjectRepository(Briefing)
    private briefingRepo: Repository<Briefing>,
    @InjectRepository(CampaignOpportunity)
    private opportunityRepo: Repository<CampaignOpportunity>,
    @InjectRepository(BriefingDistributionRecipient)
    private recipientRepo: Repository<BriefingDistributionRecipient>,
    @InjectQueue('content-workflow')
    private contentWorkflowQueue: Queue,
    private auditService: AuditService,
  ) {}

  async findCampaignOrFail(id: string, accountId: string): Promise<Campaign> {
    const campaign = await this.campaignRepo.findOne({ where: { id, accountId } });
    if (!campaign) {
      throw new NotFoundException({
        error: { code: 'CAMPAIGN_NOT_FOUND', message: 'Campanha nao encontrada.', details: {} },
      });
    }
    return campaign;
  }

  async getBriefing(campaignId: string, accountId: string) {
    await this.findCampaignOrFail(campaignId, accountId);
    const briefing = await this.findBriefingOrFail(campaignId);
    return this.format(briefing, true);
  }

  async upsertBriefing(campaignId: string, accountId: string, dto: UpsertBriefingDto, actor: ActorContext) {
    await this.findCampaignOrFail(campaignId, accountId);

    let briefing = await this.briefingRepo.findOne({ where: { campaignId } });
    if (!briefing) {
      briefing = this.briefingRepo.create({
        campaignId,
        createdByUserId: actor.userId,
        status: BriefingStatus.DRAFT,
      });
    }

    if (briefing.status === BriefingStatus.ISSUED) {
      throw new ConflictException({
        error: {
          code: 'BRIEFING_ALREADY_ISSUED',
          message: 'Este briefing ja foi emitido e nao pode mais ser editado.',
          details: {},
        },
      });
    }

    // Partial-update semantic: only fields actually present in the request
    // body are merged, every omitted field is left untouched (US-18a
    // scenario 2).
    if (dto.dos !== undefined) briefing.dos = dto.dos;
    if (dto.donts !== undefined) briefing.donts = dto.donts;
    if (dto.reference_examples !== undefined) briefing.referenceExamples = dto.reference_examples;
    if (dto.deliverable_spec !== undefined) briefing.deliverableSpec = dto.deliverable_spec;
    if (dto.deadline !== undefined) briefing.deadline = new Date(dto.deadline);

    const saved = await this.briefingRepo.save(briefing);

    await this.auditService.log({
      actorUserId: actor.userId,
      targetAccountId: accountId,
      action: 'briefing.saved',
      metadata: { briefing_id: saved.id, campaign_id: campaignId },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return this.format(saved, true);
  }

  async issueBriefing(campaignId: string, accountId: string, actor: ActorContext) {
    await this.findCampaignOrFail(campaignId, accountId);

    const briefing = await this.briefingRepo.findOne({ where: { campaignId } });

    const missingFields = this.resolveMissingFields(briefing);
    if (missingFields.length > 0) {
      throw new UnprocessableEntityException({
        error: {
          code: 'BRIEFING_INCOMPLETE',
          message: 'O briefing nao pode ser emitido: os seguintes campos estao vazios.',
          details: { missing_fields: missingFields },
        },
      });
    }

    // missingFields.length === 0 implies briefing is not null (every
    // required field check short-circuits to "missing" for a null briefing).
    const existing = briefing!;

    if (existing.status === BriefingStatus.ISSUED) {
      throw new ConflictException({
        error: {
          code: 'BRIEFING_ALREADY_ISSUED',
          message: 'Este briefing ja foi emitido e nao pode ser emitido novamente.',
          details: {},
        },
      });
    }

    existing.status = BriefingStatus.ISSUED;
    existing.issuedAt = new Date();
    existing.issuedByUserId = actor.userId;
    const saved = await this.briefingRepo.save(existing);

    // Resolve the recipient set: every distinct creator holding a
    // campaign_opportunity for this campaign at this moment, regardless of
    // that opportunity's own status (US-18b scenario 2, ADR-0029).
    const opportunities = await this.opportunityRepo.find({ where: { campaignId } });
    const recipients = opportunities.map((o) =>
      this.recipientRepo.create({
        briefingId: saved.id,
        campaignId,
        creatorId: o.creatorId,
        opportunityId: o.id,
        status: DistributionRecipientStatus.PENDING,
      }),
    );
    if (recipients.length > 0) {
      await this.recipientRepo.save(recipients);
    }

    await this.contentWorkflowQueue.add('distribute-briefing', {
      briefingId: saved.id,
      campaignId,
      correlationId: actor.correlationId,
    });

    await this.auditService.log({
      actorUserId: actor.userId,
      targetAccountId: accountId,
      action: 'briefing.issued',
      metadata: { briefing_id: saved.id, campaign_id: campaignId, recipient_count: recipients.length },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return {
      id: saved.id,
      status: saved.status,
      issued_at: saved.issuedAt!.toISOString(),
      recipients_queued: recipients.length,
    };
  }

  async getDistribution(campaignId: string, accountId: string) {
    await this.findCampaignOrFail(campaignId, accountId);
    const briefing = await this.findBriefingOrFail(campaignId);

    const recipients = await this.recipientRepo.find({ where: { briefingId: briefing.id } });
    const delivered = recipients.filter((r) => r.status === DistributionRecipientStatus.DELIVERED);
    const failed = recipients.filter((r) => r.status === DistributionRecipientStatus.FAILED);
    const pending = recipients.filter((r) => r.status === DistributionRecipientStatus.PENDING);

    return {
      briefing_id: briefing.id,
      recipients_total: recipients.length,
      delivered: delivered.length,
      failed: failed.map((r) => ({ creator_id: r.creatorId, failure_reason: r.failureReason })),
      pending: pending.length,
    };
  }

  private async findBriefingOrFail(campaignId: string): Promise<Briefing> {
    const briefing = await this.briefingRepo.findOne({ where: { campaignId } });
    if (!briefing) {
      throw new NotFoundException({
        error: { code: 'BRIEFING_NOT_FOUND', message: 'Nenhum briefing foi salvo para esta campanha ainda.', details: {} },
      });
    }
    return briefing;
  }

  // US-18a scenario 3: every one of dos/donts/reference_examples/
  // deliverable_spec/deadline must hold for the briefing to be issuable. A
  // briefing that has never been saved at all is treated as every field
  // missing, rather than a separate 404 -- FR-36's obligation is about the
  // moment of issuing, not about whether a draft row exists yet.
  private resolveMissingFields(briefing: Briefing | null): string[] {
    const missing: string[] = [];
    if (!briefing?.dos || briefing.dos.length === 0) missing.push('dos');
    if (!briefing?.donts || briefing.donts.length === 0) missing.push('donts');
    if (!briefing?.referenceExamples || briefing.referenceExamples.length === 0) {
      missing.push('reference_examples');
    }
    if (!briefing?.deliverableSpec || !briefing.deliverableSpec.format) {
      missing.push('deliverable_spec');
    }
    if (!briefing?.deadline) missing.push('deadline');
    return missing;
  }

  private format(briefing: Briefing, includeIssuedBy: boolean) {
    const base: Record<string, any> = {
      id: briefing.id,
      campaign_id: briefing.campaignId,
      status: briefing.status,
      dos: briefing.dos,
      donts: briefing.donts,
      reference_examples: briefing.referenceExamples,
      deliverable_spec: briefing.deliverableSpec,
      deadline: briefing.deadline ? briefing.deadline.toISOString() : null,
      issued_at: briefing.issuedAt ? briefing.issuedAt.toISOString() : null,
      created_at: briefing.createdAt.toISOString(),
      updated_at: briefing.updatedAt.toISOString(),
    };
    if (includeIssuedBy) {
      base.issued_by_user_id = briefing.issuedByUserId;
    }
    return base;
  }
}
