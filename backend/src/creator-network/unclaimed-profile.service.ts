import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  Creator,
  CreatorStatus,
  CreatorOnboardingStatus,
  CreatorRecruitmentOrigin,
  CreatorPublicImport,
} from '../database/entities';
import { AuditService } from '../audit/audit.service';
import { CreateUnclaimedProfileDto } from './dto';
import { UNCLAIMED_PROFILE_EXPIRY_DAYS, addDays } from './creator-network.config';

interface ActorContext {
  ipAddress: string;
  userAgent: string;
}

// US-23.1 / ADR-0054 (section 4.1 of the E8 architecture doc). The only way
// an unclaimed profile is created in this pilot: a human aurora_operator
// submitting exactly what they observed, one profile at a time. No
// automated discovery pipeline is built or implied.
@Injectable()
export class UnclaimedProfileService {
  constructor(
    @InjectRepository(Creator)
    private creatorRepo: Repository<Creator>,
    @InjectRepository(CreatorPublicImport)
    private publicImportRepo: Repository<CreatorPublicImport>,
    private dataSource: DataSource,
    private auditService: AuditService,
  ) {}

  async createUnclaimedProfile(
    dto: CreateUnclaimedProfileDto,
    operatorUserId: string,
    actor: ActorContext,
  ) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const now = new Date();
      const unclaimedExpiresAt = addDays(now, UNCLAIMED_PROFILE_EXPIRY_DAYS);

      // US-23.1 scenario 2: every metric field this epic's qualification
      // pipeline would otherwise populate is left null -- there is nothing
      // to estimate or infer from a handful of public signals.
      const creator = queryRunner.manager.create(Creator, {
        displayName: dto.display_name,
        status: CreatorStatus.UNCLAIMED,
        onboardingStatus: CreatorOnboardingStatus.PENDING,
        recruitmentOrigin: CreatorRecruitmentOrigin.RECRUITED,
        unclaimedExpiresAt,
        contentNiche: dto.observed_niche ?? null,
        audienceSize: dto.observed_follower_count ?? null,
      });
      await queryRunner.manager.save(creator);

      const publicImport = queryRunner.manager.create(CreatorPublicImport, {
        creatorId: creator.id,
        source: dto.source,
        platform: dto.platform ?? null,
        observedHandle: dto.observed_handle ?? null,
        observedDisplayName: dto.display_name,
        observedFollowerCount: dto.observed_follower_count ?? null,
        observedNiche: dto.observed_niche ?? null,
        rawPayload: null,
        importedByUserId: operatorUserId,
        importedAt: now,
      });
      await queryRunner.manager.save(publicImport);

      await queryRunner.commitTransaction();

      await this.auditService.log({
        actorUserId: operatorUserId,
        targetAccountId: null,
        action: 'creator.unclaimed_profile_created',
        metadata: { creator_id: creator.id, source: dto.source },
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });

      return {
        creator_id: creator.id,
        status: creator.status,
        unclaimed_expires_at: unclaimedExpiresAt.toISOString(),
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}
