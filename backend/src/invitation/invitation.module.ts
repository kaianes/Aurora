import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { Invitation, User, Membership, Account } from '../database/entities';
import { InvitationController } from './invitation.controller';
import { InvitationService } from './invitation.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Invitation, User, Membership, Account]),
    BullModule.registerQueue({ name: 'email' }),
  ],
  controllers: [InvitationController],
  providers: [InvitationService],
  exports: [InvitationService],
})
export class InvitationModule {}
