import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { Invitation, VerificationToken } from '../database/entities';
import { EmailProcessor } from './email.processor';
import { ScheduledTasksService } from './scheduled-tasks.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Invitation, VerificationToken]),
    BullModule.registerQueue({ name: 'email' }),
  ],
  providers: [EmailProcessor, ScheduledTasksService],
})
export class JobsModule {}
