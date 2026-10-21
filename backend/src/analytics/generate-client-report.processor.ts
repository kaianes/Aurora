import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from 'bull';
import {
  Account,
  Campaign,
  CampaignPerformanceAggregate,
  ClientPerformanceReport,
  Invoice,
  PerformanceReportStatus,
} from '../database/entities';
import { AuditService } from '../audit/audit.service';
import { AgencyBrandingService } from '../agency/agency-branding.service';
import { buildReportDocumentUrl } from './report-document-url';

// US-43 / FR-55, section 5.5 of the E7 architecture document. Aggregates
// every campaign under clientAccountId, reusing each campaign's own
// campaign_performance_aggregate row and locked_price/invoice -- never
// recomputing per-creator figures a second time.
@Processor('analytics')
export class GenerateClientReportProcessor {
  private readonly logger = new Logger(GenerateClientReportProcessor.name);

  constructor(
    @InjectRepository(ClientPerformanceReport)
    private reportRepo: Repository<ClientPerformanceReport>,
    @InjectRepository(Account)
    private accountRepo: Repository<Account>,
    @InjectRepository(Campaign)
    private campaignRepo: Repository<Campaign>,
    @InjectRepository(CampaignPerformanceAggregate)
    private aggregateRepo: Repository<CampaignPerformanceAggregate>,
    @InjectRepository(Invoice)
    private invoiceRepo: Repository<Invoice>,
    private agencyBrandingService: AgencyBrandingService,
    private auditService: AuditService,
  ) {}

  @Process('generate-client-report')
  async handle(job: Job<{ reportId: string }>) {
    const report = await this.reportRepo.findOne({ where: { id: job.data.reportId } });
    if (!report) return;

    try {
      const account = await this.accountRepo.findOne({ where: { id: report.accountId } });
      const campaigns = await this.campaignRepo.find({ where: { accountId: report.accountId } });

      let totalSpend = 0;
      let totalReach = 0n;
      let totalEngagement = 0n;
      let anyDeliveries = false;

      for (const campaign of campaigns) {
        const invoice = await this.invoiceRepo.findOne({ where: { campaignId: campaign.id } });
        totalSpend += invoice
          ? parseFloat(invoice.totalAmount)
          : parseFloat(campaign.lockedPrice || '0');

        const aggregate = await this.aggregateRepo.findOne({ where: { campaignId: campaign.id } });
        if (aggregate && aggregate.deliveredCreatorCount > 0) {
          anyDeliveries = true;
          totalReach += BigInt(aggregate.totalDeliveredReach);
          totalEngagement += BigInt(aggregate.totalDeliveredEngagement);
        }
      }

      // Section 5.5: a profile with at least logo_url set is applied; no
      // profile, or one with all three fields null, falls back to a
      // neutral template (ADR-0048).
      const brandingProfile = account
        ? await this.agencyBrandingService.getBrandingProfile(account.workspaceId)
        : null;
      const brandingApplied = !!brandingProfile?.logoUrl;

      let costPerEngagement: string | null = null;
      let cpmEquivalent: string | null = null;
      if (anyDeliveries && totalEngagement > 0n) {
        costPerEngagement = (totalSpend / Number(totalEngagement)).toFixed(4);
      }
      if (anyDeliveries && totalReach > 0n) {
        cpmEquivalent = ((totalSpend / Number(totalReach)) * 1000).toFixed(2);
      }

      report.status = PerformanceReportStatus.READY;
      report.campaignCount = campaigns.length;
      report.totalSpend = totalSpend.toFixed(2);
      report.totalDeliveredReach = anyDeliveries ? Number(totalReach) : null;
      report.totalDeliveredEngagement = anyDeliveries ? Number(totalEngagement) : null;
      report.costPerEngagement = costPerEngagement;
      report.cpmEquivalent = cpmEquivalent;
      report.brandingApplied = brandingApplied;
      report.pdfDocumentUrl = buildReportDocumentUrl('client-reports', report.id, 'pdf');
      report.csvDocumentUrl = buildReportDocumentUrl('client-reports', report.id, 'csv');
      report.resolvedAt = new Date();

      await this.reportRepo.save(report);

      await this.auditService.log({
        actorUserId: report.requestedByUserId,
        targetAccountId: report.accountId,
        action: 'client_performance_report.generated',
        metadata: {
          report_id: report.id,
          account_id: report.accountId,
          campaign_count: campaigns.length,
          branding_applied: brandingApplied,
        },
      });
    } catch (error) {
      this.logger.warn(
        `generate-client-report failed for report ${report.id}: ${(error as Error).message}`,
      );
      report.status = PerformanceReportStatus.FAILED;
      report.resolvedAt = new Date();
      await this.reportRepo.save(report);
    }
  }
}
