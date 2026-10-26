import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { CampaignReportController } from './campaign-report.controller';
import { PerformanceReportStatus } from '../database/entities';

// US-22 / FR-53, section 5.3 of the E7 architecture document. The controller
// is a thin wrapper: it forwards the path's campaignId, the resolved
// currentAccountId (set upstream by RolesGuard from the caller's own
// X-Account-Id/membership, never trusted directly from the request body),
// and the authenticated user's id, to CampaignReportService.
describe('CampaignReportController - US-22', () => {
  let controller: CampaignReportController;
  let reportService: { requestReport: ReturnType<typeof vi.fn>; getReport: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    reportService = { requestReport: vi.fn(), getReport: vi.fn() };
    controller = new CampaignReportController(reportService as any);
  });

  function reqWith(accountId: string, userId = 'user-1') {
    return { currentAccountId: accountId, user: { sub: userId } } as any;
  }

  // ---- US-22 scenario 1 (request half): POST forwards the campaign id,
  // the resolved account context, and the requesting user id -- never
  // anything read directly off the raw request body or headers. ----
  describe('requestReport (POST)', () => {
    it('forwards campaignId, currentAccountId, and the requesting user id to the service', async () => {
      reportService.requestReport.mockResolvedValue({
        report_id: 'rpt-1',
        status: PerformanceReportStatus.PENDING,
        poll_url: '/v1/campaigns/camp-1/reports/rpt-1',
      });

      const result = await controller.requestReport('camp-1', reqWith('acct-1', 'user-1'));

      expect(reportService.requestReport).toHaveBeenCalledWith('camp-1', 'acct-1', 'user-1');
      expect(result).toEqual({
        report_id: 'rpt-1',
        status: PerformanceReportStatus.PENDING,
        poll_url: '/v1/campaigns/camp-1/reports/rpt-1',
      });
    });

    // ---- CAMPAIGN_NOT_FOUND propagates unchanged from the service, the
    // controller does not swallow or translate it. ----
    it('propagates CAMPAIGN_NOT_FOUND from the service without altering it', async () => {
      reportService.requestReport.mockRejectedValue(
        new NotFoundException({
          error: { code: 'CAMPAIGN_NOT_FOUND', message: 'Campanha nao encontrada.', details: {} },
        }),
      );

      await expect(controller.requestReport('camp-ghost', reqWith('acct-1'))).rejects.toMatchObject({
        response: { error: { code: 'CAMPAIGN_NOT_FOUND' } },
      });
    });
  });

  // ---- US-22 scenario 1 (poll half): GET forwards the campaign id, report
  // id, and resolved account context, returning whatever shape the service
  // produces (pending, ready-with-figures, or ready-with-no-deliveries-
  // message) unchanged. ----
  describe('getReport (GET)', () => {
    it('forwards campaignId, reportId, and currentAccountId to the service and returns a pending report as-is', async () => {
      reportService.getReport.mockResolvedValue({
        id: 'rpt-1',
        status: PerformanceReportStatus.PENDING,
      });

      const result = await controller.getReport('camp-1', 'rpt-1', reqWith('acct-1'));

      expect(reportService.getReport).toHaveBeenCalledWith('camp-1', 'rpt-1', 'acct-1');
      expect(result).toEqual({ id: 'rpt-1', status: PerformanceReportStatus.PENDING });
    });

    it('returns a ready report with full figures as produced by the service, unchanged', async () => {
      const readyBody = {
        id: 'rpt-1',
        status: PerformanceReportStatus.READY,
        has_deliveries: true,
        total_delivered_reach: 1230000,
        total_delivered_engagement: 45210,
        cost_per_engagement: '0.9953',
        cpm_equivalent: '36.59',
      };
      reportService.getReport.mockResolvedValue(readyBody);

      const result = await controller.getReport('camp-1', 'rpt-1', reqWith('acct-1'));

      expect(result).toEqual(readyBody);
    });

    // ---- US-22 scenario 3: the no-deliveries message, as produced by the
    // service, passes through the controller untouched -- the controller
    // never fabricates or strips it. ----
    it('returns the no-deliveries message as produced by the service, unchanged', async () => {
      const noDeliveriesBody = {
        id: 'rpt-2',
        status: PerformanceReportStatus.READY,
        has_deliveries: false,
        total_delivered_reach: null,
        total_delivered_engagement: null,
        cost_per_engagement: null,
        cpm_equivalent: null,
        message:
          'Nenhuma entrega confirmada ainda. O valor investido ja esta definido; os resultados aparecerao aqui conforme as publicacoes forem confirmadas.',
      };
      reportService.getReport.mockResolvedValue(noDeliveriesBody);

      const result = await controller.getReport('camp-1', 'rpt-2', reqWith('acct-1'));

      expect(result).toEqual(noDeliveriesBody);
    });

    // ---- REPORT_NOT_FOUND propagates unchanged from the service, covering
    // both a nonexistent report id and one that belongs to a different
    // campaign/account than the one in the request path. ----
    it('propagates REPORT_NOT_FOUND from the service without altering it', async () => {
      reportService.getReport.mockRejectedValue(
        new NotFoundException({
          error: { code: 'REPORT_NOT_FOUND', message: 'Relatorio nao encontrado.', details: {} },
        }),
      );

      await expect(controller.getReport('camp-1', 'rpt-ghost', reqWith('acct-1'))).rejects.toMatchObject({
        response: { error: { code: 'REPORT_NOT_FOUND' } },
      });
    });

    // ---- Tenant isolation at the wiring level: the controller always
    // forwards the resolved currentAccountId from the request, never a
    // value a caller could supply directly -- so a different caller's
    // currentAccountId naturally scopes the service call to their own
    // account, and the service (tested in campaign-report.service.spec.ts)
    // is what actually refuses a cross-tenant read. ----
    it('scopes the lookup to whatever currentAccountId was resolved for this caller, not a fixed or client-supplied value', async () => {
      reportService.getReport.mockRejectedValue(
        new NotFoundException({
          error: { code: 'CAMPAIGN_NOT_FOUND', message: 'Campanha nao encontrada.', details: {} },
        }),
      );

      await expect(
        controller.getReport('camp-1', 'rpt-1', reqWith('acct-outsider')),
      ).rejects.toMatchObject({ response: { error: { code: 'CAMPAIGN_NOT_FOUND' } } });
      expect(reportService.getReport).toHaveBeenCalledWith('camp-1', 'rpt-1', 'acct-outsider');
    });
  });
});
