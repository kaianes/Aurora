import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Account,
  Workspace,
  Membership,
  OperatorClientAccess,
  BrandProfile,
} from '../database/entities';
import { AgencyController } from './agency.controller';
import { AgencyService } from './agency.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Account,
      Workspace,
      Membership,
      OperatorClientAccess,
      BrandProfile,
    ]),
  ],
  controllers: [AgencyController],
  providers: [AgencyService],
  exports: [AgencyService],
})
export class AgencyModule {}
