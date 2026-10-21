import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Account,
  Workspace,
  Membership,
  OperatorClientAccess,
  BrandProfile,
  AgencyBrandingProfile,
} from '../database/entities';
import { AgencyController } from './agency.controller';
import { AgencyService } from './agency.service';
import { AgencyBrandingService } from './agency-branding.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Account,
      Workspace,
      Membership,
      OperatorClientAccess,
      BrandProfile,
      AgencyBrandingProfile,
    ]),
  ],
  controllers: [AgencyController],
  providers: [AgencyService, AgencyBrandingService],
  // AgencyBrandingService.getBrandingProfile is the one method analytics's
  // report renderer calls in-process (ADR-0048, section 2.3 of the E7
  // architecture doc).
  exports: [AgencyService, AgencyBrandingService],
})
export class AgencyModule {}
