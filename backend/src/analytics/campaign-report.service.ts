import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Repository } from 'typeorm';
import { Campaign, CampaignPerformanceReport, PerformanceReportStatus } from '../database/entities';

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

    await this.analyticsQueue.add('generate-campaign-report', { reportId: report.id });

    return {
      report_id: report.id,
      status: report.status,
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
