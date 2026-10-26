import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { CampaignReportService } from './campaign-report.service';
import { PerformanceReportStatus } from '../database/entities';

const mockRepo = () => ({
  findOne: vi.fn(),
  create: vi.fn((data: any) => ({ ...data })),
  save: vi.fn((entity: any) => Promise.resolve({ id: entity.id || 'rpt-1', ...entity })),
});

describe('CampaignReportService - US-22 / FR-53', () => {
  let service: CampaignReportService;
  let campaignRepo: ReturnType<typeof mockRepo>;
  let reportRepo: ReturnType<typeof mockRepo>;
  let analyticsQueue: { add: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    campaignRepo = mockRepo();
    reportRepo = mockRepo();
    analyticsQueue = { add: vi.fn() };

    service = new CampaignReportService(campaignRepo as any, reportRepo as any, analyticsQueue as any);
  });

  // ---- US-22 scenario 1: requesting an export creates a pending report
  // and enqueues the async render job, returning a poll_url the caller can
  // follow (the request-then-poll pattern, section 5.3 of the architecture
  // doc). ----
  describe('requestReport', () => {
    it('creates a pending report, enqueues generate-campaign-report, and returns a poll_url', async () => {
      campaignRepo.findOne.mockResolvedValue({ id: 'camp-1', accountId: 'acct-1' });

      const result = await service.requestReport('camp-1', 'acct-1', 'user-1');

      expect(campaignRepo.findOne).toHaveBeenCalledWith({ where: { id: 'camp-1', accountId: 'acct-1' } });
      expect(reportRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          campaignId: 'camp-1',
          status: PerformanceReportStatus.PENDING,
          requestedByUserId: 'user-1',
        }),
      );
      expect(analyticsQueue.add).toHaveBeenCalledWith('generate-campaign-report', { reportId: 'rpt-1' });
      expect(result).toEqual({
        report_id: 'rpt-1',
        status: PerformanceReportStatus.PENDING,
        poll_url: '/v1/campaigns/camp-1/reports/rpt-1',
      });
    });

    // ---- CAMPAIGN_NOT_FOUND: requesting a report for a campaign id that
    // does not resolve under the caller's own account context. ----
    it('throws CAMPAIGN_NOT_FOUND (404) when the campaign does not belong to the caller account', async () => {
      campaignRepo.findOne.mockResolvedValue(undefined);

      await expect(service.requestReport('camp-ghost', 'acct-1', 'user-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.requestReport('camp-ghost', 'acct-1', 'user-1')).rejects.toMatchObject({
        response: { error: { code: 'CAMPAIGN_NOT_FOUND' } },
      });
      expect(analyticsQueue.add).not.toHaveBeenCalled();
    });
  });

  // ---- US-22 scenario 1 (poll half): polling a report that is still
  // pending reflects that state, and reflects ready once the async job has
  // resolved it -- the same request-then-poll contract section 5.3 of the
  // architecture doc specifies. ----
  describe('getReport', () => {
    beforeEach(() => {
      campaignRepo.findOne.mockResolvedValue({ id: 'camp-1', accountId: 'acct-1' });
    });

    it('returns a pending status while the async job has not resolved the report yet', async () => {
      reportRepo.findOne.mockResolvedValue({
        id: 'rpt-1',
        status: PerformanceReportStatus.PENDING,
        campaignProgressLabel: null,
        spendAmount: null,
        spendSource: null,
        hasDeliveries: null,
        totalDeliveredReach: null,
        totalDeliveredEngagement: null,
        costPerEngagement: null,
        cpmEquivalent: null,
        pdfDocumentUrl: null,
        csvDocumentUrl: null,
        resolvedAt: null,
      });

      const result = await service.getReport('camp-1', 'rpt-1', 'acct-1');

      expect(result.status).toBe(PerformanceReportStatus.PENDING);
      expect(result).not.toHaveProperty('message');
    });

    it('returns the full figures once the report is ready, with deliveries present', async () => {
      reportRepo.findOne.mockResolvedValue({
        id: 'rpt-1',
        status: PerformanceReportStatus.READY,
        campaignProgressLabel: 'in_progress',
        spendAmount: '45000.00',
        spendSource: 'locked_price',
        hasDeliveries: true,
        totalDeliveredReach: 1230000,
        totalDeliveredEngagement: 45210,
        costPerEngagement: '0.9953',
        cpmEquivalent: '36.59',
        pdfDocumentUrl: 'https://assets.aurora.com.br/reports/rpt-1/report.pdf',
        csvDocumentUrl: 'https://assets.aurora.com.br/reports/rpt-1/report.csv',
        resolvedAt: new Date('2026-10-21T10:00:05Z'),
      });

      const result = await service.getReport('camp-1', 'rpt-1', 'acct-1');

      expect(result).toEqual(
        expect.objectContaining({
          id: 'rpt-1',
          status: PerformanceReportStatus.READY,
          has_deliveries: true,
          total_delivered_reach: 1230000,
          total_delivered_engagement: 45210,
          cost_per_engagement: '0.9953',
          cpm_equivalent: '36.59',
          pdf_document_url: 'https://assets.aurora.com.br/reports/rpt-1/report.pdf',
          csv_document_url: 'https://assets.aurora.com.br/reports/rpt-1/report.csv',
        }),
      );
      expect(result).not.toHaveProperty('message');
    });

    // ---- CAMPAIGN_NOT_FOUND: polling under a campaign id outside the
    // caller's own account context fails the same way as requesting one
    // does, before the report row is ever looked at. ----
    it('throws CAMPAIGN_NOT_FOUND (404) when the campaign does not belong to the caller account', async () => {
      campaignRepo.findOne.mockResolvedValue(undefined);

      await expect(service.getReport('camp-ghost', 'rpt-1', 'acct-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.getReport('camp-ghost', 'rpt-1', 'acct-1')).rejects.toMatchObject({
        response: { error: { code: 'CAMPAIGN_NOT_FOUND' } },
      });
      expect(reportRepo.findOne).not.toHaveBeenCalled();
    });

    // ---- REPORT_NOT_FOUND: a report id that does not exist, or that
    // belongs to a different campaign than the one named in the path, is
    // refused -- the repo query is already scoped by both id and
    // campaignId, so this also covers a caller trying to read a real report
    // id by guessing it under the wrong campaign. ----
    it('throws REPORT_NOT_FOUND (404) when the report id does not exist for this campaign', async () => {
      reportRepo.findOne.mockResolvedValue(undefined);

      await expect(service.getReport('camp-1', 'rpt-ghost', 'acct-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.getReport('camp-1', 'rpt-ghost', 'acct-1')).rejects.toMatchObject({
        response: { error: { code: 'REPORT_NOT_FOUND' } },
      });
      expect(reportRepo.findOne).toHaveBeenCalledWith({ where: { id: 'rpt-ghost', campaignId: 'camp-1' } });
    });

    // ---- Tenant isolation: a report belonging to a campaign in a
    // different account is never readable by a caller outside that
    // account, because the campaign lookup itself is scoped to the
    // caller's own accountId -- the report row is never reached at all for
    // a cross-tenant campaign id. ----
    it('refuses to read a report when the campaign belongs to a different account entirely (tenant isolation)', async () => {
      campaignRepo.findOne.mockResolvedValue(undefined); // repo query already filters by accountId

      await expect(service.getReport('camp-1', 'rpt-1', 'acct-outsider')).rejects.toMatchObject({
        response: { error: { code: 'CAMPAIGN_NOT_FOUND' } },
      });
      expect(campaignRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'camp-1', accountId: 'acct-outsider' },
      });
      expect(reportRepo.findOne).not.toHaveBeenCalled();
    });

    // ---- US-22 scenario 3: no fabricated placeholder figures -- the
    // no-deliveries message appears, cost-efficiency and reach/engagement
    // figures stay null, never a misleading zero. ----
    it('returns the no-deliveries message, not fabricated zero figures, when has_deliveries is false', async () => {
      reportRepo.findOne.mockResolvedValue({
        id: 'rpt-2',
        status: PerformanceReportStatus.READY,
        campaignProgressLabel: 'in_progress',
        spendAmount: '45000.00',
        spendSource: 'locked_price',
        hasDeliveries: false,
        totalDeliveredReach: null,
        totalDeliveredEngagement: null,
        costPerEngagement: null,
        cpmEquivalent: null,
        pdfDocumentUrl: 'https://assets.aurora.com.br/reports/rpt-2/report.pdf',
        csvDocumentUrl: 'https://assets.aurora.com.br/reports/rpt-2/report.csv',
        resolvedAt: new Date('2026-10-21T10:00:02Z'),
      });

      const result = await service.getReport('camp-1', 'rpt-2', 'acct-1');

      expect(result.has_deliveries).toBe(false);
      expect(result.total_delivered_reach).toBeNull();
      expect(result.total_delivered_engagement).toBeNull();
      expect(result.cost_per_engagement).toBeNull();
      expect(result.cpm_equivalent).toBeNull();
      expect(result.spend_amount).toBe('45000.00'); // spend is already known even with no deliveries
      expect(result.message).toBe(
        'Nenhuma entrega confirmada ainda. O valor investido ja esta definido; os resultados aparecerao aqui conforme as publicacoes forem confirmadas.',
      );
    });

    // ---- No fabricated message leaks onto a report that does have
    // deliveries, or one that is still pending/failed -- the message is
    // only ever attached to the exact ready + no-deliveries combination. ----
    it('never attaches the no-deliveries message when the report is still pending', async () => {
      reportRepo.findOne.mockResolvedValue({
        id: 'rpt-3',
        status: PerformanceReportStatus.PENDING,
        hasDeliveries: null,
        spendAmount: null,
        spendSource: null,
        totalDeliveredReach: null,
        totalDeliveredEngagement: null,
        costPerEngagement: null,
        cpmEquivalent: null,
        campaignProgressLabel: null,
        pdfDocumentUrl: null,
        csvDocumentUrl: null,
        resolvedAt: null,
      });

      const result = await service.getReport('camp-1', 'rpt-3', 'acct-1');

      expect(result).not.toHaveProperty('message');
    });
  });
});
