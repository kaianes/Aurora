import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Account,
  Workspace,
  Membership,
  OperatorClientAccess,
  BrandProfile,
  AgencyBrandingProfile,
  CampaignTemplate,
  ClientReportShareLink,
} from '../database/entities';
import { AgencyController } from './agency.controller';
import { AgencyService } from './agency.service';
import { AgencyBrandingService } from './agency-branding.service';
import { TemplateCopyService } from './template-copy.service';
import { ClientReportShareLinkService } from './client-report-share-link.service';
import { ClientReportShareLinkController } from './client-report-share-link.controller';
import { PublicClientReportController } from './public-client-report.controller';
import { AnalyticsModule } from '../analytics/analytics.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Account,
      Workspace,
      Membership,
      OperatorClientAccess,
      BrandProfile,
      AgencyBrandingProfile,
      CampaignTemplate,
      ClientReportShareLink,
    ]),
    // Circular with AnalyticsModule: analytics imports AgencyModule for
    // AgencyBrandingService (ADR-0048); this module imports AnalyticsModule
    // for ClientReportService, to read client_performance_report in process
    // rather than agency querying that table directly (section 3.3 of the
    // E9 architecture doc). Neither service injects the other, so only the
    // module-level forwardRef is needed.
    forwardRef(() => AnalyticsModule),
  ],
  controllers: [AgencyController, ClientReportShareLinkController, PublicClientReportController],
  providers: [AgencyService, AgencyBrandingService, TemplateCopyService, ClientReportShareLinkService],
  // AgencyBrandingService.getBrandingProfile is the one method analytics's
  // report renderer calls in-process (ADR-0048, section 2.3 of the E7
  // architecture doc). TemplateCopyService is additionally exported so
  // campaign's TemplateService can reach it for the ongoing,
  // POST /campaign-templates/:id/copy action (section 4.2 of the E9
  // architecture doc) without duplicating the escape-hatch mechanics.
  exports: [AgencyService, AgencyBrandingService, TemplateCopyService],
})
export class AgencyModule {}
