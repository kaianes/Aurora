import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from 'bull';
import {
  Campaign,
  CampaignPerformanceAggregate,
  CampaignPerformanceReport,
  CampaignProgressLabel,
  CampaignState,
  Invoice,
  PerformanceReportStatus,
  SpendSource,
} from '../database/entities';
import { AuditService } from '../audit/audit.service';
import { buildReportDocumentUrl } from './report-document-url';

// US-22 / FR-53, section 5.3 of the E7 architecture document. Reads
// campaign_performance_aggregate, campaign.locked_price/state, and (if
// present) invoice.total_amount -- never recomputes any of them (section
// 3.4). Computes cost efficiency per ADR-0046 only when has_deliveries is
// true.
@Processor('analytics')
export class GenerateCampaignReportProcessor {
  private readonly logger = new Logger(GenerateCampaignReportProcessor.name);

  constructor(
    @InjectRepository(CampaignPerformanceReport)
    private reportRepo: Repository<CampaignPerformanceReport>,
    @InjectRepository(Campaign)
    private campaignRepo: Repository<Campaign>,
    @InjectRepository(CampaignPerformanceAggregate)
    private aggregateRepo: Repository<CampaignPerformanceAggregate>,
    @InjectRepository(Invoice)
    private invoiceRepo: Repository<Invoice>,
    private auditService: AuditService,
  ) {}

  @Process('generate-campaign-report')
  async handle(job: Job<{ reportId: string }>) {
    const report = await this.reportRepo.findOne({ where: { id: job.data.reportId } });
    if (!report) return;

    try {
      const campaign = await this.campaignRepo.findOne({ where: { id: report.campaignId } });
      const aggregate = await this.aggregateRepo.findOne({ where: { campaignId: report.campaignId } });
      const invoice = await this.invoiceRepo.findOne({ where: { campaignId: report.campaignId } });

      const hasDeliveries = (aggregate?.deliveredCreatorCount ?? 0) > 0;

      // "Spend" is campaign.locked_price whenever no invoice exists yet,
      // and invoice.total_amount once one has been generated (section 3.4).
      const spendAmount = invoice ? invoice.totalAmount : campaign?.lockedPrice || '0';
      const spendSource = invoice ? SpendSource.INVOICE : SpendSource.LOCKED_PRICE;

      const progressLabel =
        campaign?.state === CampaignState.COMPLETED
          ? CampaignProgressLabel.FINAL
          : CampaignProgressLabel.IN_PROGRESS;

      let totalReach: number | null = null;
      let totalEngagement: number | null = null;
      let costPerEngagement: string | null = null;
      let cpmEquivalent: string | null = null;

      if (hasDeliveries && aggregate) {
        totalReach = Number(aggregate.totalDeliveredReach);
        totalEngagement = Number(aggregate.totalDeliveredEngagement);
        const spend = parseFloat(spendAmount);

        // ADR-0046: both null, never zero, whenever the relevant
        // denominator is zero.
        if (totalEngagement > 0) {
          costPerEngagement = (spend / totalEngagement).toFixed(4);
        }
        if (totalReach > 0) {
          cpmEquivalent = ((spend / totalReach) * 1000).toFixed(2);
        }
      }

      report.status = PerformanceReportStatus.READY;
      report.hasDeliveries = hasDeliveries;
      report.spendAmount = spendAmount;
      report.spendSource = spendSource;
      report.totalDeliveredReach = totalReach;
      report.totalDeliveredEngagement = totalEngagement;
      report.costPerEngagement = costPerEngagement;
      report.cpmEquivalent = cpmEquivalent;
      report.campaignProgressLabel = progressLabel;
      report.pdfDocumentUrl = buildReportDocumentUrl('campaign-reports', report.id, 'pdf');
      report.csvDocumentUrl = buildReportDocumentUrl('campaign-reports', report.id, 'csv');
      report.resolvedAt = new Date();

      await this.reportRepo.save(report);

      await this.auditService.log({
        actorUserId: report.requestedByUserId,
        targetAccountId: campaign?.accountId ?? null,
        action: 'campaign_performance_report.generated',
        metadata: { report_id: report.id, campaign_id: report.campaignId, has_deliveries: hasDeliveries },
      });
    } catch (error) {
      this.logger.warn(
        `generate-campaign-report failed for report ${report.id}: ${(error as Error).message}`,
      );
      report.status = PerformanceReportStatus.FAILED;
      report.resolvedAt = new Date();
      await this.reportRepo.save(report);

      await this.auditService.log({
        actorUserId: report.requestedByUserId,
        targetAccountId: null,
        action: 'campaign_performance_report.generation_failed',
        metadata: { report_id: report.id, campaign_id: report.campaignId },
      });
    }
  }
}
