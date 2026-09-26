import {
  Injectable,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BrandProfile, BrandProfileStatus } from '../database/entities';
import { CreateBrandProfileDto } from './dto/create-brand-profile.dto';
import { UpdateBrandProfileDto } from './dto/update-brand-profile.dto';
import { AuditService } from '../audit/audit.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class BrandProfileService {
  constructor(
    @InjectRepository(BrandProfile)
    private brandProfileRepo: Repository<BrandProfile>,
    private auditService: AuditService,
    private configService: ConfigService,
  ) {}

  async create(
    accountId: string,
    dto: CreateBrandProfileDto,
    actorUserId: string,
    ipAddress: string,
    userAgent: string,
  ) {
    const existing = await this.brandProfileRepo.findOne({
      where: { accountId },
    });
    if (existing) {
      throw new ConflictException({
        error: {
          code: 'PROFILE_EXISTS',
          message:
            'Esta conta ja possui um perfil de marca. Use PATCH para atualizar.',
          details: {},
        },
      });
    }

    const profile = this.brandProfileRepo.create({
      accountId,
      name: dto.name,
      toneOfVoice: dto.tone_of_voice || null,
      contentGuidelines: dto.content_guidelines || null,
      prohibitedTopics: dto.prohibited_topics || null,
    });
    profile.status = profile.computeStatus();
    const saved = await this.brandProfileRepo.save(profile);

    await this.auditService.log({
      actorUserId,
      targetAccountId: accountId,
      action: 'brand_profile.created',
      metadata: { profile_id: saved.id, status: saved.status },
      ipAddress,
      userAgent,
    });

    return this.formatProfile(saved);
  }

  async update(
    profileId: string,
    accountId: string,
    dto: UpdateBrandProfileDto,
    actorUserId: string,
    ipAddress: string,
    userAgent: string,
  ) {
    const profile = await this.brandProfileRepo.findOne({
      where: { id: profileId, accountId },
    });
    if (!profile) {
      throw new NotFoundException({
        error: {
          code: 'PROFILE_NOT_FOUND',
          message: 'Perfil de marca nao encontrado.',
          details: {},
        },
      });
    }

    // Apply partial update -- only update fields that are present in the dto
    if (dto.name !== undefined) profile.name = dto.name;
    if (dto.tone_of_voice !== undefined)
      profile.toneOfVoice = dto.tone_of_voice;
    if (dto.content_guidelines !== undefined)
      profile.contentGuidelines = dto.content_guidelines;
    if (dto.prohibited_topics !== undefined)
      profile.prohibitedTopics = dto.prohibited_topics;

    profile.status = profile.computeStatus();
    const saved = await this.brandProfileRepo.save(profile);

    await this.auditService.log({
      actorUserId,
      targetAccountId: accountId,
      action: 'brand_profile.updated',
      metadata: {
        profile_id: saved.id,
        status: saved.status,
        updated_fields: Object.keys(dto),
      },
      ipAddress,
      userAgent,
    });

    return this.formatProfile(saved);
  }

  async getCurrent(accountId: string) {
    const profile = await this.brandProfileRepo.findOne({
      where: { accountId },
    });
    if (!profile) {
      throw new NotFoundException({
        error: {
          code: 'PROFILE_NOT_FOUND',
          message: 'Nenhum perfil de marca encontrado para esta conta.',
          details: {},
        },
      });
    }
    return this.formatProfile(profile);
  }

  async uploadLogo(
    profileId: string,
    accountId: string,
    file: { fieldname: string; originalname: string; encoding: string; mimetype: string; size: number; buffer: Buffer },
    actorUserId: string,
    ipAddress: string,
    userAgent: string,
  ) {
    const maxSize = 5 * 1024 * 1024; // 5 MB
    const allowedMimeTypes = [
      'image/png',
      'image/jpeg',
      'image/jpg',
      'image/svg+xml',
      'image/webp',
    ];

    if (file.size > maxSize) {
      throw new UnprocessableEntityException({
        error: {
          code: 'FILE_TOO_LARGE',
          message: 'O arquivo excede o limite de 5 MB.',
          details: { max_size_mb: 5 },
        },
      });
    }

    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new UnprocessableEntityException({
        error: {
          code: 'UNSUPPORTED_FORMAT',
          message:
            'Formato de arquivo nao suportado. Formatos aceitos: PNG, JPG, JPEG, SVG, WEBP.',
          details: { allowed_formats: ['PNG', 'JPG', 'JPEG', 'SVG', 'WEBP'] },
        },
      });
    }

    const profile = await this.brandProfileRepo.findOne({
      where: { id: profileId, accountId },
    });
    if (!profile) {
      throw new NotFoundException({
        error: {
          code: 'PROFILE_NOT_FOUND',
          message: 'Perfil de marca nao encontrado.',
          details: {},
        },
      });
    }

    // In production, this would upload to S3 and generate a signed URL.
    // For now, store a reference path.
    const ext = file.originalname.split('.').pop() || 'png';
    const s3Key = `brand-profiles/${profileId}/logo.${ext}`;
    const baseUrl = this.configService.get('S3_PUBLIC_URL') || 'https://assets.aurora.com.br';
    const logoUrl = `${baseUrl}/${s3Key}`;

    profile.logoUrl = s3Key;
    profile.status = profile.computeStatus();
    const saved = await this.brandProfileRepo.save(profile);

    await this.auditService.log({
      actorUserId,
      targetAccountId: accountId,
      action: 'brand_profile.logo_uploaded',
      metadata: { profile_id: saved.id, s3_key: s3Key },
      ipAddress,
      userAgent,
    });

    return {
      logo_url: logoUrl,
      status: saved.status,
    };
  }

  private formatProfile(profile: BrandProfile) {
    return {
      id: profile.id,
      account_id: profile.accountId,
      name: profile.name,
      logo_url: profile.logoUrl,
      tone_of_voice: profile.toneOfVoice,
      content_guidelines: profile.contentGuidelines,
      prohibited_topics: profile.prohibitedTopics,
      status: profile.status,
      created_at: profile.createdAt.toISOString(),
      updated_at: profile.updatedAt.toISOString(),
    };
  }
}
