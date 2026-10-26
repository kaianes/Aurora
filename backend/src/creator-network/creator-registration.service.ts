import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import {
  Creator,
  CreatorStatus,
  CreatorOnboardingStatus,
  CreatorRecruitmentOrigin,
  CreatorConsentRecord,
  CreatorConsentType,
} from '../database/entities';
import { AuthService } from '../auth/auth.service';
import { RegisterCreatorDto } from './dto';
import { LoginDto } from '../auth/dto';

// US-24.1 / ADR-0050 (section 5.1-5.2 of the E8 architecture doc). A
// creator's credential is a user row created through AuthService's shared
// code path -- no workspace, account, or membership row, exactly the shape
// E3 already assumed. Replaces creator-portal.controller.ts's former
// pilot-only login stub.
@Injectable()
export class CreatorRegistrationService {
  constructor(
    @InjectRepository(Creator)
    private creatorRepo: Repository<Creator>,
    private dataSource: DataSource,
    private authService: AuthService,
    private jwtService: JwtService,
  ) {}

  async register(dto: RegisterCreatorDto): Promise<{ message: string; user_id: string }> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const { user, isNew } = await this.authService.createUser(queryRunner.manager, {
        email: dto.email,
        password: dto.password,
        name: dto.name,
      });

      if (!isNew) {
        // Same enumeration-safe behavior as E1's brand register (ADR-0001):
        // no creator row is created for an email that already belongs to a
        // user, but the response never reveals that.
        await queryRunner.commitTransaction();
        return {
          message: 'Conta criada com sucesso. Verifique seu email para ativar sua conta.',
          user_id: user.id,
        };
      }

      const creator = queryRunner.manager.create(Creator, {
        userId: user.id,
        displayName: dto.name,
        status: CreatorStatus.ACTIVE,
        onboardingStatus: CreatorOnboardingStatus.PENDING,
        recruitmentOrigin: CreatorRecruitmentOrigin.SELF_REGISTERED,
      });
      await queryRunner.manager.save(creator);

      const now = new Date();
      const consent = queryRunner.manager.create(CreatorConsentRecord, {
        creatorId: creator.id,
        consentType: CreatorConsentType.TERMS_ACCEPTANCE,
        scope: null,
        termsVersion: dto.terms_version,
        grantedAt: now,
      });
      await queryRunner.manager.save(consent);

      const verificationToken = await this.authService.issueVerificationToken(
        queryRunner.manager,
        user.id,
      );

      await queryRunner.commitTransaction();

      await this.authService.enqueueVerificationEmail(user.email, user.name, verificationToken);

      return {
        message: 'Conta criada com sucesso. Verifique seu email para ativar sua conta.',
        user_id: user.id,
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

  async verifyEmail(token: string) {
    const user = await this.authService.verifyEmailToken(token);
    const creator = await this.creatorRepo.findOne({ where: { userId: user.id } });

    const accessToken = this.jwtService.sign(
      { sub: user.id, creator_id: creator?.id },
      { expiresIn: '15m' },
    );

    return {
      message: 'Email verificado com sucesso. Voce ja pode fazer login.',
      access_token: accessToken,
      expires_in: 900,
    };
  }

  // Identical semantics to E1's brand login (credential check, email-
  // verified gate), except the issued JWT carries creator_id instead of
  // memberships, and there is no MFA branch -- creators hold no FR-04 role
  // and no financial-approval capability (ADR-0050).
  async login(dto: LoginDto) {
    const user = await this.authService.authenticateCredentials(dto.email, dto.password);
    const creator = await this.creatorRepo.findOne({ where: { userId: user.id } });

    const accessToken = this.jwtService.sign(
      { sub: user.id, creator_id: creator?.id },
      { expiresIn: '15m' },
    );

    return {
      access_token: accessToken,
      expires_in: 900,
    };
  }
}
