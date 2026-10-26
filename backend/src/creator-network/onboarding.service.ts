import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Creator, CreatorOnboardingStatus, CreatorSocialAccount, SocialAccountStatus } from '../database/entities';
import { UpdateCreatorProfileDto } from './dto';

const PENDING_MESSAGE =
  'Ainda estamos analisando seu perfil. Avisaremos por email quando a decisao estiver pronta.';

// US-24.4 (section 5.7 of the E8 architecture doc). A pure read of the
// creator's current row -- no second source of truth for qualification
// state.
@Injectable()
export class OnboardingService {
  constructor(
    @InjectRepository(Creator)
    private creatorRepo: Repository<Creator>,
    @InjectRepository(CreatorSocialAccount)
    private socialAccountRepo: Repository<CreatorSocialAccount>,
  ) {}

  async getStatus(creatorId: string) {
    const creator = await this.findOrFail(creatorId);
    const connected = await this.socialAccountRepo.find({
      where: { creatorId, status: SocialAccountStatus.CONNECTED },
    });

    const base: Record<string, any> = {
      onboarding_status: creator.onboardingStatus,
      status: creator.status,
    };

    if (creator.onboardingStatus === CreatorOnboardingStatus.QUALIFIED) {
      base.linked_platforms = connected.map((a) => a.platform);
      base.audience_size = creator.audienceSize;
      base.engagement_rate = creator.engagementRate;
      base.authenticity_score =
        creator.authenticityScore !== null ? Number(creator.authenticityScore) : null;
      base.authenticity_status = creator.authenticityStatus;
      base.qualification_decided_at = creator.qualificationDecidedAt?.toISOString() ?? null;
    } else if (creator.onboardingStatus === CreatorOnboardingStatus.NOT_QUALIFIED) {
      base.qualification_missing_criteria = creator.qualificationMissingCriteria;
      base.qualification_decided_at = creator.qualificationDecidedAt?.toISOString() ?? null;
    } else {
      base.qualification_expected_ready_at =
        creator.qualificationExpectedReadyAt?.toISOString() ?? null;
      base.message = PENDING_MESSAGE;
    }

    return base;
  }

  async updateProfile(creatorId: string, dto: UpdateCreatorProfileDto) {
    const creator = await this.findOrFail(creatorId);
    if (dto.display_name !== undefined) creator.displayName = dto.display_name;
    if (dto.content_niche !== undefined) creator.contentNiche = dto.content_niche;
    await this.creatorRepo.save(creator);
    return {
      creator_id: creator.id,
      display_name: creator.displayName,
      content_niche: creator.contentNiche,
    };
  }

  private async findOrFail(creatorId: string): Promise<Creator> {
    const creator = await this.creatorRepo.findOne({ where: { id: creatorId } });
    if (!creator) {
      throw new NotFoundException({
        error: { code: 'CREATOR_NOT_FOUND', message: 'Criador nao encontrado.', details: {} },
      });
    }
    return creator;
  }
}
