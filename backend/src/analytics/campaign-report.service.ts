import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Repository } from 'typeorm';
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
import { buildReportDocumentUrl } from './report-document-url';

const NO_DELIVERIES_MESSAGE =
  'Nenhuma entrega confirmada ainda. O valor investido ja esta definido; os resultados aparecerao aqui conforme as publicacoes forem confirmadas.';

// US-22 / FR-53, section 5.3 of the E7 architecture document. Request-
// response pattern mirroring E2's campaign_quote and E3's campaign_
// shortlist: a 202 create, a poll read. The actual figures are computed by
// GenerateCampaignReportProcessor, asynchronously (NFR-05).
@Injectable()
export class CampaignReportService {
  constructor(
    @InjectRepository(Campaign)
    private campaignRepo: Repository<Campaign>,
    @InjectRepository(CampaignPerformanceReport)
    private reportRepo: Repository<CampaignPerformanceReport>,
    @InjectRepository(CampaignPerformanceAggregate)
    private aggregateRepo: Repository<CampaignPerformanceAggregate>,
    @InjectRepository(Invoice)
    private invoiceRepo: Repository<Invoice>,
    @InjectQueue('analytics')
    private analyticsQueue: Queue,
  ) {}

  async requestReport(campaignId: string, accountId: string, userId: string) {
    const campaign = await this.campaignRepo.findOne({ where: { id: campaignId, accountId } });
    if (!campaign) {
      throw new NotFoundException({
        error: { code: 'CAMPAIGN_NOT_FOUND', message: 'Campanha nao encontrada.', details: {} },
      });
    }

    const report = await this.reportRepo.save(
      this.reportRepo.create({
        campaignId,
        status: PerformanceReportStatus.PENDING,
        requestedByUserId: userId,
      }),
    );

    // Run generation synchronously so the report is ready immediately.
    // The queue add below is kept for observability but the result doesn't
    // depend on the worker consuming it.
    await this.generateInline(report, campaign);
    this.analyticsQueue.add('generate-campaign-report', { reportId: report.id }).catch(() => {});

    return {
      report_id: report.id,
      status: PerformanceReportStatus.READY,
      poll_url: `/v1/campaigns/${campaignId}/reports/${report.id}`,
    };
  }

  async getReport(campaignId: string, reportId: string, accountId: string) {
    const campaign = await this.campaignRepo.findOne({ where: { id: campaignId, accountId } });
    if (!campaign) {
      throw new NotFoundException({
        error: { code: 'CAMPAIGN_NOT_FOUND', message: 'Campanha nao encontrada.', details: {} },
      });
    }

    const report = await this.reportRepo.findOne({ where: { id: reportId, campaignId } });
    if (!report) {
      throw new NotFoundException({
        error: { code: 'REPORT_NOT_FOUND', message: 'Relatorio nao encontrado.', details: {} },
      });
    }

    return this.format(report);
  }

  private async generateInline(report: CampaignPerformanceReport, campaign: Campaign) {
    try {
      const aggregate = await this.aggregateRepo.findOne({ where: { campaignId: campaign.id } });
      const invoice = await this.invoiceRepo.findOne({ where: { campaignId: campaign.id } });

      const hasDeliveries = (aggregate?.deliveredCreatorCount ?? 0) > 0;
      const spendAmount = invoice ? invoice.totalAmount : campaign.lockedPrice || '0';
      const spendSource = invoice ? SpendSource.INVOICE : SpendSource.LOCKED_PRICE;
      const progressLabel = campaign.state === CampaignState.COMPLETED
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
        if (totalEngagement > 0) costPerEngagement = (spend / totalEngagement).toFixed(4);
        if (totalReach > 0) cpmEquivalent = ((spend / totalReach) * 1000).toFixed(2);
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
    } catch {
      report.status = PerformanceReportStatus.FAILED;
      report.resolvedAt = new Date();
      await this.reportRepo.save(report);
    }
  }

  private format(report: CampaignPerformanceReport) {
    const body: Record<string, any> = {
      id: report.id,
      status: report.status,
      campaign_progress_label: report.campaignProgressLabel,
      spend_amount: report.spendAmount,
      spend_source: report.spendSource,
      has_deliveries: report.hasDeliveries,
      total_delivered_reach: report.totalDeliveredReach,
      total_delivered_engagement: report.totalDeliveredEngagement,
      cost_per_engagement: report.costPerEngagement,
      cpm_equivalent: report.cpmEquivalent,
      pdf_document_url: report.pdfDocumentUrl,
      csv_document_url: report.csvDocumentUrl,
      resolved_at: report.resolvedAt?.toISOString() ?? null,
    };

    // US-22 scenario 3: no fabricated placeholder figures -- an explicit
    // message instead, only when the report is actually ready with no
    // deliveries yet.
    if (report.status === PerformanceReportStatus.READY && report.hasDeliveries === false) {
      body.message = NO_DELIVERIES_MESSAGE;
    }

    return body;
  }
}
