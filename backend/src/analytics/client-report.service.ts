import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Repository } from 'typeorm';
import { Account, ClientPerformanceReport, PerformanceReportStatus } from '../database/entities';

// US-43 / FR-55, section 5.5 of the E7 architecture document. The caller's
// X-Account-Id is already set to clientAccountId itself (section 2.5) by
// the time a request reaches this service -- RolesGuard's existing
// account-access resolution has already refused any client the caller
// cannot act on, before this service ever runs (US-43 scenario 3).
@Injectable()
export class ClientReportService {
  constructor(
    @InjectRepository(Account)
    private accountRepo: Repository<Account>,
    @InjectRepository(ClientPerformanceReport)
    private reportRepo: Repository<ClientPerformanceReport>,
    @InjectQueue('analytics')
    private analyticsQueue: Queue,
  ) {}

  async requestReport(clientAccountId: string, actorUserId: string) {
    const account = await this.accountRepo.findOne({ where: { id: clientAccountId } });
    if (!account) {
      throw new NotFoundException({
        error: {
          code: 'CLIENT_NOT_FOUND',
          message: 'Conta de cliente nao encontrada.',
          details: {},
        },
      });
    }

    const report = await this.reportRepo.save(
      this.reportRepo.create({
        accountId: clientAccountId,
        status: PerformanceReportStatus.PENDING,
        requestedByUserId: actorUserId,
      }),
    );

    await this.analyticsQueue.add('generate-client-report', { reportId: report.id });

    return {
      report_id: report.id,
      status: report.status,
      poll_url: `/v1/agency/clients/${clientAccountId}/reports/${report.id}`,
    };
  }

  async getReport(clientAccountId: string, reportId: string) {
    const report = await this.reportRepo.findOne({
      where: { id: reportId, accountId: clientAccountId },
    });
    if (!report) {
      throw new NotFoundException({
        error: { code: 'REPORT_NOT_FOUND', message: 'Relatorio nao encontrado.', details: {} },
      });
    }

    return {
      id: report.id,
      status: report.status,
      campaign_count: report.campaignCount,
      total_spend: report.totalSpend,
      total_delivered_reach: report.totalDeliveredReach,
      total_delivered_engagement: report.totalDeliveredEngagement,
      cost_per_engagement: report.costPerEngagement,
      cpm_equivalent: report.cpmEquivalent,
      branding_applied: report.brandingApplied,
      pdf_document_url: report.pdfDocumentUrl,
      csv_document_url: report.csvDocumentUrl,
      resolved_at: report.resolvedAt?.toISOString() ?? null,
    };
  }

  // US-44 / FR-57, section 3.3/5.5 of the E9 architecture doc: the one new
  // exported method this epic adds, narrowly scoped to the public figures
  // the token-gated share-link view renders -- not the full admin-facing
  // shape getReport returns (no id, status, branding_applied, resolved_at).
  // Called only after agency's public controller has already validated the
  // share link's token, expiry, and revocation state; accountId here is the
  // link's own, already-trusted account_id, not caller input.
  async getReportForSharing(reportId: string, accountId: string) {
    const report = await this.reportRepo.findOne({
      where: { id: reportId, accountId },
    });
    if (!report) {
      throw new NotFoundException({
        error: { code: 'REPORT_NOT_FOUND', message: 'Relatorio nao encontrado.', details: {} },
      });
    }

    return {
      campaign_count: report.campaignCount,
      total_spend: report.totalSpend,
      total_delivered_reach: report.totalDeliveredReach,
      total_delivered_engagement: report.totalDeliveredEngagement,
      cost_per_engagement: report.costPerEngagement,
      cpm_equivalent: report.cpmEquivalent,
      pdf_document_url: report.pdfDocumentUrl,
      csv_document_url: report.csvDocumentUrl,
    };
  }
}
