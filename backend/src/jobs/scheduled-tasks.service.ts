import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { Invitation, InvitationStatus } from '../database/entities/invitation.entity';
import { VerificationToken } from '../database/entities/verification-token.entity';

@Injectable()
export class ScheduledTasksService {
  private readonly logger = new Logger(ScheduledTasksService.name);

  constructor(
    @InjectRepository(Invitation)
    private invitationRepo: Repository<Invitation>,
    @InjectRepository(VerificationToken)
    private verificationTokenRepo: Repository<VerificationToken>,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async expireInvitations() {
    const result = await this.invitationRepo.update(
      {
        status: InvitationStatus.PENDING,
        expiresAt: LessThan(new Date()),
      },
      { status: InvitationStatus.EXPIRED },
    );

    if (result.affected && result.affected > 0) {
      this.logger.log(`Expired ${result.affected} invitations`);
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async expireVerificationTokens() {
    const result = await this.verificationTokenRepo.delete({
      used: false,
      expiresAt: LessThan(new Date()),
    });

    if (result.affected && result.affected > 0) {
      this.logger.log(`Deleted ${result.affected} expired verification tokens`);
    }
  }
}
