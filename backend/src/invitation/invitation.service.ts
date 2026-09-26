import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  UnprocessableEntityException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import {
  Invitation,
  InvitationStatus,
  User,
  Membership,
  Role,
  Account,
} from '../database/entities';
import { AuditService } from '../audit/audit.service';
import { ConfigService } from '@nestjs/config';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';

@Injectable()
export class InvitationService {
  constructor(
    @InjectRepository(Invitation) private invitationRepo: Repository<Invitation>,
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(Membership) private membershipRepo: Repository<Membership>,
    @InjectRepository(Account) private accountRepo: Repository<Account>,
    private dataSource: DataSource,
    private auditService: AuditService,
    private configService: ConfigService,
    @InjectQueue('email') private emailQueue: Queue,
  ) {}

  async create(
    accountId: string,
    workspaceType: string,
    dto: CreateInvitationDto,
    actorUserId: string,
    ipAddress: string,
    userAgent: string,
  ) {
    const email = dto.email.toLowerCase().trim();

    // Validate role is valid for workspace type
    const brandRoles = ['brand_manager', 'brand_analyst'];
    const agencyRoles = ['agency_operator'];
    if (workspaceType === 'brand' && !brandRoles.includes(dto.role)) {
      throw new UnprocessableEntityException({
        error: {
          code: 'INVALID_ROLE',
          message: `O papel "${dto.role}" nao e valido para um workspace de marca.`,
          details: { valid_roles: brandRoles },
        },
      });
    }
    if (workspaceType === 'agency' && !agencyRoles.includes(dto.role)) {
      throw new UnprocessableEntityException({
        error: {
          code: 'INVALID_ROLE',
          message: `O papel "${dto.role}" nao e valido para um workspace de agencia.`,
          details: { valid_roles: agencyRoles },
        },
      });
    }

    // Check for existing pending invitation
    const existing = await this.invitationRepo.findOne({
      where: {
        accountId,
        email,
        status: InvitationStatus.PENDING,
      },
    });
    if (existing) {
      throw new ConflictException({
        error: {
          code: 'INVITATION_PENDING',
          message:
            'Ja existe um convite pendente para este email. Deseja reenviar?',
          details: { invitation_id: existing.id },
        },
      });
    }

    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const invitation = this.invitationRepo.create({
      accountId,
      email,
      role: dto.role,
      token,
      status: InvitationStatus.PENDING,
      expiresAt,
    });
    const saved = await this.invitationRepo.save(invitation);

    // Get account name for email
    const account = await this.accountRepo.findOne({
      where: { id: accountId },
      relations: { workspace: true },
    });

    await this.emailQueue.add('send-email', {
      template: 'invitation',
      to: email,
      subject: `Voce foi convidado para ${account?.name || 'um workspace'} na Aurora`,
      data: {
        workspace_name: account?.name,
        role: dto.role,
        invitation_url: `${this.configService.get('FRONTEND_URL')}/invitations/accept?token=${token}`,
      },
    });

    await this.auditService.log({
      actorUserId,
      targetAccountId: accountId,
      action: 'invitation.created',
      metadata: { invitation_id: saved.id, email, role: dto.role },
      ipAddress,
      userAgent,
    });

    return {
      id: saved.id,
      email: saved.email,
      role: saved.role,
      status: saved.status,
      expires_at: saved.expiresAt.toISOString(),
      created_at: saved.createdAt.toISOString(),
    };
  }

  async resend(
    invitationId: string,
    accountId: string,
    actorUserId: string,
    ipAddress: string,
    userAgent: string,
  ) {
    const invitation = await this.invitationRepo.findOne({
      where: { id: invitationId, accountId },
    });
    if (!invitation) {
      throw new NotFoundException({
        error: {
          code: 'NOT_FOUND',
          message: 'Convite nao encontrado.',
          details: {},
        },
      });
    }

    if (invitation.status !== InvitationStatus.PENDING) {
      throw new BadRequestException({
        error: {
          code: 'INVITATION_NOT_PENDING',
          message: 'O convite nao esta pendente.',
          details: {},
        },
      });
    }

    const newToken = crypto.randomBytes(32).toString('base64url');
    invitation.token = newToken;
    invitation.expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await this.invitationRepo.save(invitation);

    const account = await this.accountRepo.findOne({
      where: { id: accountId },
    });

    await this.emailQueue.add('send-email', {
      template: 'invitation',
      to: invitation.email,
      subject: `Voce foi convidado para ${account?.name || 'um workspace'} na Aurora`,
      data: {
        workspace_name: account?.name,
        role: invitation.role,
        invitation_url: `${this.configService.get('FRONTEND_URL')}/invitations/accept?token=${newToken}`,
      },
    });

    await this.auditService.log({
      actorUserId,
      targetAccountId: accountId,
      action: 'invitation.resent',
      metadata: { invitation_id: invitationId },
      ipAddress,
      userAgent,
    });

    return {
      message: 'Convite reenviado com sucesso.',
      expires_at: invitation.expiresAt.toISOString(),
    };
  }

  async list(
    accountId: string,
    status?: string,
    cursor?: string,
    limit: number = 20,
  ) {
    const qb = this.invitationRepo
      .createQueryBuilder('invitation')
      .where('invitation.account_id = :accountId', { accountId })
      .orderBy('invitation.created_at', 'DESC')
      .take(Math.min(limit, 100));

    if (status) {
      qb.andWhere('invitation.status = :status', { status });
    }

    if (cursor) {
      const decoded = Buffer.from(cursor, 'base64').toString('utf-8');
      qb.andWhere('invitation.created_at < :cursor', { cursor: decoded });
    }

    const invitations = await qb.getMany();
    const hasMore = invitations.length === Math.min(limit, 100);
    const nextCursor =
      hasMore && invitations.length > 0
        ? Buffer.from(
            invitations[invitations.length - 1].createdAt.toISOString(),
          ).toString('base64')
        : null;

    return {
      data: invitations.map((inv) => ({
        id: inv.id,
        email: inv.email,
        role: inv.role,
        status: inv.status,
        expires_at: inv.expiresAt.toISOString(),
        created_at: inv.createdAt.toISOString(),
      })),
      pagination: {
        next_cursor: nextCursor,
        has_more: hasMore,
      },
    };
  }

  async accept(
    dto: AcceptInvitationDto,
    authenticatedUserId: string | null,
    ipAddress: string,
    userAgent: string,
  ) {
    const invitation = await this.invitationRepo.findOne({
      where: { token: dto.token },
      relations: { account: { workspace: true } },
    });

    if (
      !invitation ||
      invitation.status !== InvitationStatus.PENDING
    ) {
      throw new BadRequestException({
        error: {
          code: 'INVALID_TOKEN',
          message: 'Token invalido ou convite ja aceito.',
          details: {},
        },
      });
    }

    if (new Date() > invitation.expiresAt) {
      throw new BadRequestException({
        error: {
          code: 'INVITATION_EXPIRED',
          message:
            'O convite expirou. Solicite um novo convite ao administrador.',
          details: {},
        },
      });
    }

    let user: User;

    if (authenticatedUserId) {
      // Existing user
      const existingUser = await this.userRepo.findOne({
        where: { id: authenticatedUserId },
      });
      if (!existingUser) {
        throw new BadRequestException({
          error: {
            code: 'INVALID_TOKEN',
            message: 'Usuario nao encontrado.',
            details: {},
          },
        });
      }
      user = existingUser;
    } else {
      // New user -- name and password required
      if (!dto.name || !dto.password) {
        throw new UnprocessableEntityException({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Nome e senha sao obrigatorios para novos usuarios.',
            details: {},
          },
        });
      }

      // Check if user with this email already exists
      const existingByEmail = await this.userRepo.findOne({
        where: { email: invitation.email },
      });
      if (existingByEmail) {
        user = existingByEmail;
      } else {
        const passwordHash = await bcrypt.hash(dto.password, 12);
        user = this.userRepo.create({
          email: invitation.email,
          passwordHash,
          name: dto.name,
          emailVerified: true,
          emailVerifiedAt: new Date(),
        });
        await this.userRepo.save(user);
      }
    }

    // Create membership
    const membership = this.membershipRepo.create({
      userId: user.id,
      accountId: invitation.accountId,
      role: invitation.role as Role,
    });
    await this.membershipRepo.save(membership);

    // Update invitation
    invitation.status = InvitationStatus.ACCEPTED;
    invitation.acceptedAt = new Date();
    await this.invitationRepo.save(invitation);

    await this.auditService.log({
      actorUserId: user.id,
      targetAccountId: invitation.accountId,
      action: 'invitation.accepted',
      metadata: { invitation_id: invitation.id, role: invitation.role },
      ipAddress,
      userAgent,
    });

    // Notify inviter
    await this.emailQueue.add('send-email', {
      template: 'invitation_accepted',
      to: '', // Would look up inviter email
      subject: `${user.name} aceitou seu convite`,
      data: {
        invitee_name: user.name,
        workspace_name: invitation.account?.name,
      },
    });

    return {
      message: 'Convite aceito. Voce agora faz parte do workspace.',
      account_id: invitation.accountId,
      workspace_id: invitation.account?.workspaceId,
      role: invitation.role,
    };
  }

  async cancel(
    invitationId: string,
    accountId: string,
    actorUserId: string,
    ipAddress: string,
    userAgent: string,
  ) {
    const invitation = await this.invitationRepo.findOne({
      where: { id: invitationId, accountId },
    });
    if (!invitation) {
      throw new NotFoundException({
        error: {
          code: 'NOT_FOUND',
          message: 'Convite nao encontrado.',
          details: {},
        },
      });
    }

    invitation.status = InvitationStatus.CANCELLED;
    await this.invitationRepo.save(invitation);

    await this.auditService.log({
      actorUserId,
      targetAccountId: accountId,
      action: 'invitation.cancelled',
      metadata: { invitation_id: invitationId },
      ipAddress,
      userAgent,
    });
  }
}
