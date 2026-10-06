import {
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreatorExclusion, ExclusionType } from '../database/entities';
import { AuditService } from '../audit/audit.service';
import { CreateExclusionDto } from './dto/create-exclusion.dto';

interface ActorContext {
  userId: string;
  ipAddress: string;
  userAgent: string;
}

@Injectable()
export class ExclusionService {
  constructor(
    @InjectRepository(CreatorExclusion)
    private exclusionRepo: Repository<CreatorExclusion>,
    private auditService: AuditService,
  ) {}

  // US-14 scenario 1/2: applied before ranking, brand- and campaign-level
  // scopes combine with OR semantics with no reconciliation required.
  async create(accountId: string, dto: CreateExclusionDto, actor: ActorContext) {
    if (dto.exclusion_type === 'creator' && !dto.creator_id) {
      throw this.invalidCombination();
    }
    if (dto.exclusion_type === 'competitor_brand' && !dto.competitor_name) {
      throw this.invalidCombination();
    }
    if (dto.scope === 'campaign' && !dto.campaign_id) {
      throw this.invalidCombination();
    }

    const exclusion = this.exclusionRepo.create({
      accountId,
      campaignId: dto.scope === 'campaign' ? dto.campaign_id! : null,
      exclusionType: dto.exclusion_type as ExclusionType,
      creatorId: dto.exclusion_type === 'creator' ? dto.creator_id! : null,
      competitorName: dto.exclusion_type === 'competitor_brand' ? dto.competitor_name! : null,
      createdByUserId: actor.userId,
    });
    const saved = await this.exclusionRepo.save(exclusion);

    await this.auditService.log({
      actorUserId: actor.userId,
      targetAccountId: accountId,
      action: 'exclusion.created',
      metadata: {
        exclusion_id: saved.id,
        scope: dto.scope,
        exclusion_type: saved.exclusionType,
      },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    // US-14 scenario 3: does not retroactively modify any existing shortlist.
    return { ...this.format(saved), applies_to: 'future_shortlist_generations_only' };
  }

  async list(accountId: string, campaignId?: string) {
    const where: any = { accountId };
    if (campaignId) {
      where.campaignId = campaignId;
    }
    const rows = await this.exclusionRepo.find({ where, order: { createdAt: 'DESC' } });
    return {
      data: rows.map((r) => this.format(r)),
      pagination: { next_cursor: null, has_more: false },
    };
  }

  async remove(id: string, accountId: string, actor: ActorContext) {
    const exclusion = await this.exclusionRepo.findOne({ where: { id, accountId } });
    if (!exclusion) {
      return;
    }
    await this.exclusionRepo.remove(exclusion);

    await this.auditService.log({
      actorUserId: actor.userId,
      targetAccountId: accountId,
      action: 'exclusion.removed',
      metadata: { exclusion_id: id },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
  }

  // Resolves all brand- and campaign-level exclusions for a campaign into a
  // flat, unioned creator-id list for the matching engine (ADR-0014).
  async resolveExcludedCreatorIds(accountId: string, campaignId: string): Promise<string[]> {
    const rows = await this.exclusionRepo
      .createQueryBuilder('e')
      .where('e.accountId = :accountId', { accountId })
      .andWhere('(e.campaignId IS NULL OR e.campaignId = :campaignId)', { campaignId })
      .andWhere('e.exclusionType = :type', { type: ExclusionType.CREATOR })
      .getMany();

    return rows.filter((r) => r.creatorId).map((r) => r.creatorId!);
  }

  private invalidCombination() {
    return new UnprocessableEntityException({
      error: {
        code: 'INVALID_EXCLUSION_COMBINATION',
        message:
          'A combinacao de exclusion_type com o campo identificador (creator_id ou competitor_name) e invalida.',
        details: {},
      },
    });
  }

  private format(exclusion: CreatorExclusion) {
    return {
      id: exclusion.id,
      scope: exclusion.campaignId ? 'campaign' : 'brand',
      campaign_id: exclusion.campaignId,
      exclusion_type: exclusion.exclusionType,
      creator_id: exclusion.creatorId,
      competitor_name: exclusion.competitorName,
      created_at: exclusion.createdAt.toISOString(),
    };
  }
}
