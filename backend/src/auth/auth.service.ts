import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { generateSecret, generateURI, verifySync } from 'otplib';
import {
  User,
  Workspace,
  WorkspaceType,
  Account,
  Membership,
  Role,
  VerificationToken,
  TokenPurpose,
} from '../database/entities';
import { AuditService } from '../audit/audit.service';
import { RegisterDto, LoginDto } from './dto';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(Workspace) private workspaceRepo: Repository<Workspace>,
    @InjectRepository(Account) private accountRepo: Repository<Account>,
    @InjectRepository(Membership) private membershipRepo: Repository<Membership>,
    @InjectRepository(VerificationToken)
    private verificationTokenRepo: Repository<VerificationToken>,
    private dataSource: DataSource,
    private jwtService: JwtService,
    private configService: ConfigService,
    private auditService: AuditService,
    @InjectQueue('email') private emailQueue: Queue,
  ) {}

  async register(
    dto: RegisterDto,
    ipAddress: string,
    userAgent: string,
  ): Promise<{ message: string; user_id: string }> {
    const email = dto.email.toLowerCase().trim();

    // Check if email exists -- return same response to prevent enumeration
    const existingUser = await this.userRepo.findOne({ where: { email } });
    if (existingUser) {
      // Optionally notify existing user
      await this.emailQueue.add('send-email', {
        template: 'existing_account_registration_attempt',
        to: email,
        subject: 'Tentativa de registro com seu email',
        data: { email },
      });
      return {
        message:
          'Conta criada com sucesso. Verifique seu email para ativar sua conta.',
        user_id: existingUser.id,
      };
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Create user
      const user = queryRunner.manager.create(User, {
        email,
        passwordHash,
        name: dto.name,
      });
      await queryRunner.manager.save(user);

      // Create workspace
      const wsType =
        dto.workspace_type === 'brand'
          ? WorkspaceType.BRAND
          : WorkspaceType.AGENCY;
      const workspace = queryRunner.manager.create(Workspace, {
        name: dto.workspace_name,
        type: wsType,
        maxClientAccounts: wsType === WorkspaceType.AGENCY ? 10 : 1,
      });
      await queryRunner.manager.save(workspace);

      // Create account
      const account = queryRunner.manager.create(Account, {
        workspaceId: workspace.id,
        name: dto.workspace_name,
      });
      await queryRunner.manager.save(account);

      // Create membership
      const ownerRole =
        wsType === WorkspaceType.BRAND ? Role.BRAND_OWNER : Role.AGENCY_ADMIN;
      const membership = queryRunner.manager.create(Membership, {
        userId: user.id,
        accountId: account.id,
        role: ownerRole,
      });
      await queryRunner.manager.save(membership);

      // Generate verification token
      const token = crypto.randomBytes(32).toString('base64url');
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const verificationToken = queryRunner.manager.create(VerificationToken, {
        userId: user.id,
        token,
        purpose: TokenPurpose.EMAIL_VERIFICATION,
        expiresAt,
      });
      await queryRunner.manager.save(verificationToken);

      await queryRunner.commitTransaction();

      // Send verification email asynchronously
      await this.emailQueue.add('send-email', {
        template: 'email_verification',
        to: email,
        subject: 'Ative sua conta Aurora',
        data: {
          name: dto.name,
          verification_url: `${this.configService.get('FRONTEND_URL')}/verify-email?token=${token}`,
        },
      });

      // Audit log
      await this.auditService.log({
        actorUserId: user.id,
        targetAccountId: account.id,
        action: 'user.registered',
        metadata: {
          workspace_type: dto.workspace_type,
          workspace_name: dto.workspace_name,
        },
        ipAddress,
        userAgent,
      });

      return {
        message:
          'Conta criada com sucesso. Verifique seu email para ativar sua conta.',
        user_id: user.id,
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async verifyEmail(token: string, ipAddress: string, userAgent: string) {
    const verificationToken = await this.verificationTokenRepo.findOne({
      where: { token, purpose: TokenPurpose.EMAIL_VERIFICATION },
    });

    if (!verificationToken || verificationToken.used) {
      throw new BadRequestException({
        error: {
          code: 'INVALID_TOKEN',
          message: 'Token invalido ou ja utilizado.',
          details: {},
        },
      });
    }

    if (new Date() > verificationToken.expiresAt) {
      throw new BadRequestException({
        error: {
          code: 'VERIFICATION_EXPIRED',
          message:
            'O link de verificacao expirou. Solicite um novo link.',
          details: {
            resend_url: '/auth/resend-verification',
          },
        },
      });
    }

    // Mark token as used and verify user
    verificationToken.used = true;
    await this.verificationTokenRepo.save(verificationToken);

    const user = await this.userRepo.findOne({
      where: { id: verificationToken.userId },
    });
    if (!user) {
      throw new BadRequestException({
        error: {
          code: 'INVALID_TOKEN',
          message: 'Token invalido.',
          details: {},
        },
      });
    }

    user.emailVerified = true;
    user.emailVerifiedAt = new Date();
    await this.userRepo.save(user);

    // Issue tokens
    const tokens = await this.issueTokens(user);

    await this.auditService.log({
      actorUserId: user.id,
      targetAccountId: null,
      action: 'user.email_verified',
      metadata: {},
      ipAddress,
      userAgent,
    });

    return {
      message: 'Email verificado com sucesso. Voce ja pode fazer login.',
      ...tokens,
    };
  }

  async resendVerification(email: string) {
    const normalizedEmail = email.toLowerCase().trim();
    const user = await this.userRepo.findOne({
      where: { email: normalizedEmail },
    });

    if (user && !user.emailVerified) {
      // Invalidate existing tokens
      await this.verificationTokenRepo.update(
        { userId: user.id, purpose: TokenPurpose.EMAIL_VERIFICATION, used: false },
        { used: true },
      );

      // Create new token
      const token = crypto.randomBytes(32).toString('base64url');
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const verificationToken = this.verificationTokenRepo.create({
        userId: user.id,
        token,
        purpose: TokenPurpose.EMAIL_VERIFICATION,
        expiresAt,
      });
      await this.verificationTokenRepo.save(verificationToken);

      await this.emailQueue.add('send-email', {
        template: 'email_verification',
        to: normalizedEmail,
        subject: 'Ative sua conta Aurora',
        data: {
          name: user.name,
          verification_url: `${this.configService.get('FRONTEND_URL')}/verify-email?token=${token}`,
        },
      });
    }

    // Always return generic message
    return {
      message:
        'Se este email estiver cadastrado, um novo link de verificacao sera enviado.',
    };
  }

  async login(dto: LoginDto, ipAddress: string, userAgent: string) {
    const email = dto.email.toLowerCase().trim();
    const user = await this.userRepo.findOne({ where: { email } });

    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      if (user) {
        await this.auditService.log({
          actorUserId: user.id,
          targetAccountId: null,
          action: 'user.login_failed',
          metadata: { reason: 'invalid_credentials' },
          ipAddress,
          userAgent,
        });
      }
      throw new UnauthorizedException({
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Email ou senha invalidos.',
          details: {},
        },
      });
    }

    if (!user.emailVerified) {
      throw new ForbiddenException({
        error: {
          code: 'EMAIL_NOT_VERIFIED',
          message: 'Sua conta ainda nao foi verificada. Verifique seu email.',
          details: {},
        },
      });
    }

    if (user.mfaEnabled) {
      if (!dto.mfa_code) {
        throw new ForbiddenException({
          error: {
            code: 'MFA_REQUIRED',
            message: 'Codigo MFA necessario.',
            details: {},
          },
        });
      }

      const isValid = verifySync({
        strategy: 'totp',
        token: dto.mfa_code,
        secret: user.mfaSecret!,
      }).valid;

      if (!isValid) {
        await this.auditService.log({
          actorUserId: user.id,
          targetAccountId: null,
          action: 'user.login_failed',
          metadata: { reason: 'invalid_mfa' },
          ipAddress,
          userAgent,
        });
        throw new UnauthorizedException({
          error: {
            code: 'INVALID_CREDENTIALS',
            message: 'Codigo MFA invalido.',
            details: {},
          },
        });
      }
    }

    const memberships = await this.membershipRepo.find({
      where: { userId: user.id },
      relations: { account: { workspace: true } },
    });

    const tokens = await this.issueTokens(user, memberships);

    await this.auditService.log({
      actorUserId: user.id,
      targetAccountId: memberships[0]?.accountId || null,
      action: 'user.login',
      metadata: {},
      ipAddress,
      userAgent,
    });

    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        mfa_enabled: user.mfaEnabled,
      },
      memberships: memberships.map((m) => ({
        account_id: m.accountId,
        account_name: m.account.name,
        workspace_id: m.account.workspaceId,
        workspace_type: m.account.workspace.type,
        role: m.role,
      })),
    };
  }

  async refresh(refreshToken: string) {
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get('JWT_REFRESH_SECRET'),
      });

      const user = await this.userRepo.findOne({
        where: { id: payload.sub },
      });
      if (!user) {
        throw new UnauthorizedException();
      }

      const memberships = await this.membershipRepo.find({
        where: { userId: user.id },
        relations: { account: { workspace: true } },
      });

      return this.issueTokens(user, memberships);
    } catch {
      throw new UnauthorizedException({
        error: {
          code: 'INVALID_TOKEN',
          message: 'Token de atualizacao invalido ou expirado.',
          details: {},
        },
      });
    }
  }

  async mfaSetup(userId: string) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();

    const secret = generateSecret();

    // Store temporarily -- will be persisted on confirm
    // Use a simple in-memory approach via the user entity mfaSecret field
    // but only set mfaEnabled on confirm
    user.mfaSecret = secret;
    await this.userRepo.save(user);

    const otpauthUrl = generateURI({ strategy: 'totp', issuer: 'Aurora', label: user.email, secret });

    // Generate backup codes
    const backupCodes = Array.from({ length: 8 }, () =>
      crypto.randomBytes(4).toString('hex'),
    );

    return {
      secret,
      qr_code_url: otpauthUrl,
      backup_codes: backupCodes,
    };
  }

  async mfaConfirm(
    userId: string,
    code: string,
    ipAddress: string,
    userAgent: string,
  ) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user || !user.mfaSecret) {
      throw new BadRequestException({
        error: {
          code: 'MFA_NOT_SETUP',
          message: 'Configure o MFA primeiro usando /auth/mfa/setup.',
          details: {},
        },
      });
    }

    const isValid = verifySync({
      strategy: 'totp',
      token: code,
      secret: user.mfaSecret,
    }).valid;

    if (!isValid) {
      throw new BadRequestException({
        error: {
          code: 'INVALID_MFA_CODE',
          message: 'Codigo MFA invalido. Tente novamente.',
          details: {},
        },
      });
    }

    user.mfaEnabled = true;
    await this.userRepo.save(user);

    await this.auditService.log({
      actorUserId: user.id,
      targetAccountId: null,
      action: 'user.mfa_enabled',
      metadata: {},
      ipAddress,
      userAgent,
    });

    return {
      message: 'MFA ativado com sucesso.',
    };
  }

  private async issueTokens(user: User, memberships?: Membership[]) {
    let membershipData: any[] = [];
    if (memberships) {
      membershipData = memberships.map((m) => ({
        account_id: m.accountId,
        role: m.role,
      }));
    } else {
      const mems = await this.membershipRepo.find({
        where: { userId: user.id },
      });
      membershipData = mems.map((m) => ({
        account_id: m.accountId,
        role: m.role,
      }));
    }

    const accessPayload = {
      sub: user.id,
      email: user.email,
      memberships: membershipData,
    };

    const accessToken = this.jwtService.sign(accessPayload, {
      secret: this.configService.get('JWT_SECRET'),
      expiresIn: '15m',
    });

    const refreshToken = this.jwtService.sign(
      { sub: user.id },
      {
        secret: this.configService.get('JWT_REFRESH_SECRET'),
        expiresIn: '7d',
      },
    );

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: 900,
    };
  }
}
