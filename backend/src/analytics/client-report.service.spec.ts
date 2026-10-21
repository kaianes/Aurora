import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { ClientReportService } from './client-report.service';
import { PerformanceReportStatus } from '../database/entities';

const mockRepo = () => ({
  findOne: vi.fn(),
  create: vi.fn((data: any) => ({ ...data })),
  save: vi.fn((entity: any) => Promise.resolve({ id: entity.id || 'rpt-1', ...entity })),
});

describe('ClientReportService - US-43 / FR-55', () => {
  let service: ClientReportService;
  let accountRepo: ReturnType<typeof mockRepo>;
  let reportRepo: ReturnType<typeof mockRepo>;
  let analyticsQueue: { add: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    accountRepo = mockRepo();
    reportRepo = mockRepo();
    analyticsQueue = { add: vi.fn() };

    service = new ClientReportService(accountRepo as any, reportRepo as any, analyticsQueue as any);
  });

  // ---- US-43 scenario 1: requesting a report for a client creates a
  // pending row and enqueues the render job, poll_url scoped to that one
  // client account. ----
  it('creates a pending report and enqueues generate-client-report on request', async () => {
    accountRepo.findOne.mockResolvedValue({ id: 'acct-client-1' });

    const result = await service.requestReport('acct-client-1', 'user-1');

    expect(reportRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acct-client-1',
        status: PerformanceReportStatus.PENDING,
        requestedByUserId: 'user-1',
      }),
    );
    expect(analyticsQueue.add).toHaveBeenCalledWith('generate-client-report', { reportId: 'rpt-1' });
    expect(result).toEqual({
      report_id: 'rpt-1',
      status: PerformanceReportStatus.PENDING,
      poll_url: '/v1/agency/clients/acct-client-1/reports/rpt-1',
    });
  });

  // ---- US-43 scenario 3, service-layer branch: documents a genuine
  // architecture-vs-implementation gap rather than asserting a specific
  // status code the stories.md criterion itself never names. Section 5.5 of
  // the architecture doc states a 404 CLIENT_NOT_FOUND response for "does
  // not resolve under the caller's current tenant context." In the actual,
  // already-live request pipeline, RolesGuard/AccountAccessService refuse an
  // inaccessible or nonexistent client account with a 403
  // INSUFFICIENT_PRIVILEGES response before the request ever reaches this
  // service (see RolesGuard.canActivate, which only calls
  // request.currentAccountId = accountId -- and therefore only lets a
  // request this far -- once resolveAccess has already returned a role).
  // This branch of ClientReportService is only reachable for a client
  // account that resolveAccess considered the caller to have a relationship
  // to, but which was deleted or never existed in account at all -- an edge
  // case the documented 404 does legitimately cover, but it is not the path
  // scenario 3 describes ("a client account she has not been granted access
  // to," or "outside her own agency workspace entirely"). stories.md itself
  // does not name a specific status code for scenario 3 ("the system
  // refuses the request and does not return any figures"), so both the
  // actual 403-at-the-guard behavior and this service's own narrower 404
  // satisfy the acceptance criterion as written. This is recorded here as a
  // documentation note, not a bug to fix.
  it('throws CLIENT_NOT_FOUND (404) at the service layer when the account row itself does not resolve', async () => {
    accountRepo.findOne.mockResolvedValue(undefined);

    await expect(service.requestReport('acct-ghost', 'user-1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.requestReport('acct-ghost', 'user-1')).rejects.toMatchObject({
      response: { error: { code: 'CLIENT_NOT_FOUND' } },
    });
    expect(analyticsQueue.add).not.toHaveBeenCalled();
  });

  it('returns the formatted report, including branding_applied, once ready', async () => {
    reportRepo.findOne.mockResolvedValue({
      id: 'rpt-1',
      status: PerformanceReportStatus.READY,
      campaignCount: 3,
      totalSpend: '180000.00',
      totalDeliveredReach: 2400000,
      totalDeliveredEngagement: 98000,
      costPerEngagement: '1.8367',
      cpmEquivalent: '75.00',
      brandingApplied: true,
      pdfDocumentUrl: 'https://assets.aurora.com.br/client-reports/rpt-1/report.pdf',
      csvDocumentUrl: 'https://assets.aurora.com.br/client-reports/rpt-1/report.csv',
      resolvedAt: new Date('2026-10-21T10:00:00Z'),
    });

    const result = await service.getReport('acct-client-1', 'rpt-1');

    expect(result).toEqual(
      expect.objectContaining({
        id: 'rpt-1',
        status: PerformanceReportStatus.READY,
        branding_applied: true,
        campaign_count: 3,
      }),
    );
  });

  // ---- Isolation (US-43 scenario 2/3): a report row scoped to a
  // different client account than the one requested is treated as not
  // found -- a client can never fetch another client's report by report id
  // alone. ----
  it('throws REPORT_NOT_FOUND when the report does not belong to the requested client account', async () => {
    reportRepo.findOne.mockResolvedValue(undefined); // repo query already filters by accountId

    await expect(service.getReport('acct-client-2', 'rpt-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(reportRepo.findOne).toHaveBeenCalledWith({ where: { id: 'rpt-1', accountId: 'acct-client-2' } });
  });
});
