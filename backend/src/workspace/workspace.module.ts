import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Workspace,
  Account,
  Membership,
  OperatorClientAccess,
  User,
} from '../database/entities';
import { WorkspaceController } from './workspace.controller';
import { WorkspaceService } from './workspace.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Workspace,
      Account,
      Membership,
      OperatorClientAccess,
      User,
    ]),
  ],
  controllers: [WorkspaceController],
  providers: [WorkspaceService],
  exports: [WorkspaceService],
})
export class WorkspaceModule {}
