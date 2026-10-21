import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { DataSource, Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import {
  Creator,
  CreatorStatus,
  CreatorInvitation,
  CreatorInvitationStatus,
  CreatorPublicImport,
  CreatorConsentRecord,
  CreatorConsentType,
} from '../database/entities';
import { AuthService } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';
import { CreateInvitationDto, ConfirmClaimDto } from './dto';
import { CREATOR_INVITATION_EXPIRY_DAYS, addDays } from './creator-network.config';

interface ActorContext {
  ipAddress: string;
  userAgent: string;
}

// US-23.2 / ADR-0055 (sections 4.2-4.5 of the E8 architecture doc).
@Injectable()
export class InvitationService {
  constructor(
    @InjectRepository(Creator)
    private creatorRepo: Repository<Creator>,
    @InjectRepository(CreatorInvitation)
    private invitationRepo: Repository<CreatorInvitation>,
    @InjectRepository(CreatorPublicImport)
    private publicImportRepo: Repository<CreatorPublicImport>,
    private dataSource: DataSource,
    private authService: AuthService,
    private auditService: AuditService,
    private jwtService: JwtService,
    private configService: ConfigService,
    @InjectQueue('email') private emailQueue: Queue,
  ) {}

  // POST /ops/creators/:id/invitations (section 4.2)
  async dispatchInvitation(
    creatorId: string,
    dto: CreateInvitationDto,
    operatorUserId: string,
    actor: ActorContext,
  ) {
    const creator = await this.creatorRepo.findOne({ where: { id: creatorId } });
    if (!creator || creator.status !== CreatorStatus.UNCLAIMED) {
      throw new NotFoundException({
        error: { code: 'CREATOR_NOT_FOUND', message: 'Criador nao encontrado.', details: {} },
      });
    }

    const existingPending = await this.invitationRepo.findOne({
      where: { creatorId, status: CreatorInvitationStatus.PENDING },
    });
    if (existingPending) {
      throw new ConflictException({
        error: {
          code: 'INVITATION_ALREADY_PENDING',
          message: 'Ja existe um convite pendente para este criador.',
          details: {},
        },
      });
    }

    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = addDays(new Date(), CREATOR_INVITATION_EXPIRY_DAYS);

    const invitation = this.invitationRepo.create({
      creatorId,
      token,
      contactEmail: dto.contact_email,
      status: CreatorInvitationStatus.PENDING,
      expiresAt,
      createdByUserId: operatorUserId,
    });
    await this.invitationRepo.save(invitation);

    await this.emailQueue.add('send-email', {
      template: 'creator_invitation',
      to: dto.contact_email,
      subject: 'Voce foi convidada para a Aurora',
      data: {
        display_name: creator.displayName,
        claim_url: `${this.configService.get('FRONTEND_URL')}/creator-portal/invitations/${token}`,
      },
    });

    await this.auditService.log({
      actorUserId: operatorUserId,
      targetAccountId: null,
      action: 'creator_invitation.created',
      metadata: { invitation_id: invitation.id, creator_id: creatorId },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return {
      invitation_id: invitation.id,
      status: invitation.status,
      expires_at: expiresAt.toISOString(),
    };
  }

  // GET /creator-portal/invitations/:token (section 4.3). Public, read-only.
  // A single 410 covers every non-pending reason here (past expiry, already
  // declined, or already accepted) -- deliberately simpler than confirm's
  // two-code distinction (section 4.3's own error taxonomy).
  async previewInvitation(token: string) {
    const invitation = await this.findInvitationByToken(token);
    if (
      invitation.status !== CreatorInvitationStatus.PENDING ||
      invitation.expiresAt < new Date()
    ) {
      throw new GoneException({
        error: { code: 'INVITATION_EXPIRED', message: 'Este convite nao esta mais disponivel.', details: {} },
      });
    }

    const creator = await this.creatorRepo.findOne({ where: { id: invitation.creatorId as string } });
    const publicImport = invitation.creatorId
      ? await this.publicImportRepo.findOne({ where: { creatorId: invitation.creatorId } })
      : null;

    return {
      invitation_id: invitation.id,
      status: invitation.status,
      imported_data: {
        display_name: creator?.displayName ?? null,
        platform: publicImport?.platform ?? null,
        observed_handle: publicImport?.observedHandle ?? null,
        observed_follower_count: publicImport?.observedFollowerCount ?? null,
        observed_niche: publicImport?.observedNiche ?? null,
      },
    };
  }

  // POST /creator-portal/invitations/:token/confirm (section 4.4). Unlike
  // preview, this distinguishes 410 (genuinely time-expired) from 409
  // (already resolved by a prior accept or decline).
  async confirmClaim(token: string, dto: ConfirmClaimDto) {
    const invitation = await this.findResolvableInvitationOrFail(token);

    if (!dto.accepted_terms) {
      throw new BadRequestException({
        error: {
          code: 'TERMS_NOT_ACCEPTED',
          message: 'E necessario aceitar os termos para confirmar o perfil.',
          details: {},
        },
      });
    }

    const creatorId = invitation.creatorId as string;

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const { user, isNew } = await this.authService.createUser(queryRunner.manager, {
        email: dto.email,
        password: dto.password,
        name: dto.corrections?.display_name ?? dto.email,
      });

      if (!isNew) {
        await queryRunner.rollbackTransaction();
        throw new UnprocessableEntityException({
          error: {
            code: 'EMAIL_ALREADY_REGISTERED',
            message: 'Este email ja esta cadastrado.',
            details: {},
          },
        });
      }

      const creator = await queryRunner.manager.findOne(Creator, { where: { id: creatorId } });
      if (!creator) {
        await queryRunner.rollbackTransaction();
        throw new NotFoundException({
          error: { code: 'CREATOR_NOT_FOUND', message: 'Criador nao encontrado.', details: {} },
        });
      }

      const now = new Date();

      // US-23.2 scenario 2: corrections fully replace the imported value for
      // that field -- never merged. Unspecified fields keep their existing
      // (imported) value.
      if (dto.corrections?.display_name !== undefined) {
        creator.displayName = dto.corrections.display_name;
      }
      if (dto.corrections?.content_niche !== undefined) {
        creator.contentNiche = dto.corrections.content_niche;
      }
      creator.userId = user.id;
      creator.status = CreatorStatus.ACTIVE;
      creator.claimedAt = now;
      creator.unclaimedExpiresAt = null;
      await queryRunner.manager.save(creator);

      invitation.status = CreatorInvitationStatus.ACCEPTED;
      invitation.respondedAt = now;
      await queryRunner.manager.save(invitation);

      const termsAcceptance = queryRunner.manager.create(CreatorConsentRecord, {
        creatorId: creator.id,
        consentType: CreatorConsentType.TERMS_ACCEPTANCE,
        scope: null,
        termsVersion: dto.terms_version,
        grantedAt: now,
      });
      await queryRunner.manager.save(termsAcceptance);

      const profileClaim = queryRunner.manager.create(CreatorConsentRecord, {
        creatorId: creator.id,
        consentType: CreatorConsentType.PROFILE_CLAIM,
        scope: null,
        termsVersion: dto.terms_version,
        grantedAt: now,
      });
      await queryRunner.manager.save(profileClaim);

      const verificationToken = await this.authService.issueVerificationToken(
        queryRunner.manager,
        user.id,
      );

      await queryRunner.commitTransaction();

      await this.authService.enqueueVerificationEmail(user.email, user.name, verificationToken);

      const accessToken = this.jwtService.sign(
        { sub: user.id, creator_id: creator.id },
        { expiresIn: '15m' },
      );

      await this.auditService.log({
        actorUserId: user.id,
        targetAccountId: null,
        action: 'creator.claimed',
        metadata: { creator_id: creator.id, invitation_id: invitation.id },
      });

      return {
        creator_id: creator.id,
        status: creator.status,
        access_token: accessToken,
        expires_in: 900,
        message: 'Verifique seu email para confirmar sua conta.',
      };
    } catch (error) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  // POST /creator-portal/invitations/:token/decline (section 4.5). Same
  // two-code precondition shape as confirm: the same entity, the same
  // "already resolved" vs "time-expired" distinction.
  async declineInvitation(token: string, actor: ActorContext) {
    const invitation = await this.findResolvableInvitationOrFail(token);
    const creatorId = invitation.creatorId as string;
    const now = new Date();

    invitation.status = CreatorInvitationStatus.DECLINED;
    invitation.respondedAt = now;
    await this.invitationRepo.save(invitation);

    // The audit log, not the creator row, is the durable record that this
    // happened -- written before the deletion (section 4.5 of the E8
    // architecture doc).
    await this.auditService.log({
      actorUserId: null,
      targetAccountId: null,
      action: 'creator.invitation_declined',
      metadata: { creator_id: creatorId, invitation_id: invitation.id },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    // Hard delete: creator_public_import cascades automatically (ON DELETE
    // CASCADE); this invitation row's own creator_id is set null by the
    // database (ON DELETE SET NULL), preserving this row as the durable
    // record that an invitation was sent and refused (ADR-0055).
    await this.creatorRepo.delete({ id: creatorId });

    return { status: invitation.status };
  }

  private async findInvitationByToken(token: string): Promise<CreatorInvitation> {
    const invitation = await this.invitationRepo.findOne({ where: { token } });
    if (!invitation) {
      throw new NotFoundException({
        error: { code: 'INVITATION_NOT_FOUND', message: 'Convite nao encontrado.', details: {} },
      });
    }
    return invitation;
  }

  private async findResolvableInvitationOrFail(token: string): Promise<CreatorInvitation> {
    const invitation = await this.findInvitationByToken(token);

    if (
      invitation.status === CreatorInvitationStatus.ACCEPTED ||
      invitation.status === CreatorInvitationStatus.DECLINED
    ) {
      throw new ConflictException({
        error: {
          code: 'INVITATION_ALREADY_RESOLVED',
          message: 'Este convite ja foi respondido.',
          details: {},
        },
      });
    }

    if (invitation.status === CreatorInvitationStatus.EXPIRED || invitation.expiresAt < new Date()) {
      throw new GoneException({
        error: { code: 'INVITATION_EXPIRED', message: 'Este convite expirou.', details: {} },
      });
    }

    return invitation;
  }
}
