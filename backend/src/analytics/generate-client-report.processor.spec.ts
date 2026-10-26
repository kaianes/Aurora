import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GenerateClientReportProcessor } from './generate-client-report.processor';
import { PerformanceReportStatus } from '../database/entities';

const mockRepo = () => ({
  findOne: vi.fn(),
  find: vi.fn().mockResolvedValue([]),
  save: vi.fn((entity: any) => Promise.resolve(entity)),
});

function makeJob(reportId: string) {
  return { data: { reportId } } as any;
}

describe('GenerateClientReportProcessor - US-43 / FR-55', () => {
  let processor: GenerateClientReportProcessor;
  let reportRepo: ReturnType<typeof mockRepo>;
  let accountRepo: ReturnType<typeof mockRepo>;
  let campaignRepo: ReturnType<typeof mockRepo>;
  let aggregateRepo: ReturnType<typeof mockRepo>;
  let invoiceRepo: ReturnType<typeof mockRepo>;
  let agencyBrandingService: { getBrandingProfile: ReturnType<typeof vi.fn> };
  let auditService: { log: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    reportRepo = mockRepo();
    accountRepo = mockRepo();
    campaignRepo = mockRepo();
    aggregateRepo = mockRepo();
    invoiceRepo = mockRepo();
    agencyBrandingService = { getBrandingProfile: vi.fn() };
    auditService = { log: vi.fn() };

    processor = new GenerateClientReportProcessor(
      reportRepo as any,
      accountRepo as any,
      campaignRepo as any,
      aggregateRepo as any,
      invoiceRepo as any,
      agencyBrandingService as any,
      auditService as any,
    );

    reportRepo.findOne.mockResolvedValue({
      id: 'rpt-1',
      accountId: 'acct-client-1',
      requestedByUserId: 'user-1',
    });
    accountRepo.findOne.mockResolvedValue({ id: 'acct-client-1', workspaceId: 'ws-1' });
  });

  // ---- US-43 scenario 1, unbranded: a report generated before the agency
  // has configured any branding states branding_applied: false, and still
  // carries the same content a direct-brand report would (spend, reach,
  // engagement, cost efficiency per US-22). ----
  it('sets branding_applied false when no branding profile exists yet', async () => {
    campaignRepo.find.mockResolvedValue([{ id: 'camp-1', lockedPrice: '45000.00' }]);
    invoiceRepo.findOne.mockResolvedValue(undefined);
    aggregateRepo.findOne.mockResolvedValue({
      deliveredCreatorCount: 10,
      totalDeliveredReach: '1230000',
      totalDeliveredEngagement: '45210',
    });
    agencyBrandingService.getBrandingProfile.mockResolvedValue(undefined); // no profile configured

    await processor.handle(makeJob('rpt-1'));

    const saved = reportRepo.save.mock.calls[0][0];
    expect(saved.brandingApplied).toBe(false);
    expect(saved.status).toBe(PerformanceReportStatus.READY);
    expect(saved.totalSpend).toBe('45000.00');
    expect(saved.totalDeliveredReach).toBe(1230000);
    expect(saved.totalDeliveredEngagement).toBe(45210);
    expect(saved.costPerEngagement).not.toBeNull();
    expect(saved.cpmEquivalent).not.toBeNull();
  });

  // ---- US-43 scenario 1, branded: once the agency configures at least a
  // logo, a report generated afterward states branding_applied: true. ----
  it('sets branding_applied true once the agency has configured a logo', async () => {
    campaignRepo.find.mockResolvedValue([{ id: 'camp-1', lockedPrice: '45000.00' }]);
    invoiceRepo.findOne.mockResolvedValue(undefined);
    aggregateRepo.findOne.mockResolvedValue({
      deliveredCreatorCount: 10,
      totalDeliveredReach: '1230000',
      totalDeliveredEngagement: '45210',
    });
    agencyBrandingService.getBrandingProfile.mockResolvedValue({
      logoUrl: 'https://cdn.example.com/logo.png',
      primaryColorHex: '#3DDC97',
      secondaryColorHex: '#7F77DD',
    });

    await processor.handle(makeJob('rpt-1'));

    const saved = reportRepo.save.mock.calls[0][0];
    expect(saved.brandingApplied).toBe(true);
    expect(agencyBrandingService.getBrandingProfile).toHaveBeenCalledWith('ws-1');
  });

  // ---- An all-null-fields profile (the row exists but nothing was ever
  // actually set) is treated the same as no profile at all -- branding
  // applied is driven by logo_url specifically, not by row existence. ----
  it('sets branding_applied false when a profile row exists but every field is still null', async () => {
    campaignRepo.find.mockResolvedValue([]);
    agencyBrandingService.getBrandingProfile.mockResolvedValue({
      logoUrl: null,
      primaryColorHex: null,
      secondaryColorHex: null,
    });

    await processor.handle(makeJob('rpt-1'));

    expect(reportRepo.save.mock.calls[0][0].brandingApplied).toBe(false);
  });

  // ---- US-22 scenario 3's "never fabricate zero" rule, reused here: no
  // delivered creator across any of the client's campaigns means
  // cost-efficiency figures are null, not zero or NaN. ----
  it('leaves cost_per_engagement and cpm_equivalent null when no campaign under the client has delivered anything', async () => {
    campaignRepo.find.mockResolvedValue([{ id: 'camp-1', lockedPrice: '45000.00' }]);
    invoiceRepo.findOne.mockResolvedValue(undefined);
    aggregateRepo.findOne.mockResolvedValue({
      deliveredCreatorCount: 0,
      totalDeliveredReach: '0',
      totalDeliveredEngagement: '0',
    });

    await processor.handle(makeJob('rpt-1'));

    const saved = reportRepo.save.mock.calls[0][0];
    expect(saved.costPerEngagement).toBeNull();
    expect(saved.cpmEquivalent).toBeNull();
    expect(saved.totalDeliveredReach).toBeNull();
    expect(saved.totalDeliveredEngagement).toBeNull();
    // Spend is still reported -- the fixed price is already known, even
    // with nothing delivered yet.
    expect(saved.totalSpend).toBe('45000.00');
  });

  // ---- Spend precedence (section 3.4): once an invoice exists for a
  // campaign, its total is used over the locked price -- this epic never
  // recomputes either figure, only reads the one that is authoritative. ----
  it('uses invoice.total_amount over locked_price once an invoice exists for a campaign', async () => {
    campaignRepo.find.mockResolvedValue([{ id: 'camp-1', lockedPrice: '45000.00' }]);
    invoiceRepo.findOne.mockResolvedValue({ totalAmount: '43500.00' }); // e.g. a FR-19 refund adjustment
    aggregateRepo.findOne.mockResolvedValue(undefined);

    await processor.handle(makeJob('rpt-1'));

    expect(reportRepo.save.mock.calls[0][0].totalSpend).toBe('43500.00');
  });

  // ---- Isolation (US-43 scenario 2): a client with several campaigns gets
  // the sum across exactly those campaigns, never another client's. This
  // processor only ever queries campaignRepo scoped by this report's own
  // accountId, so another client's campaigns are structurally unreachable. ----
  it('aggregates only the requested client account own campaigns, scoped by accountId', async () => {
    campaignRepo.find.mockResolvedValue([
      { id: 'camp-1', lockedPrice: '100000.00' },
      { id: 'camp-2', lockedPrice: '80000.00' },
    ]);
    invoiceRepo.findOne.mockResolvedValue(undefined);
    aggregateRepo.findOne.mockImplementation(({ where }: any) => {
      if (where.campaignId === 'camp-1') {
        return Promise.resolve({
          deliveredCreatorCount: 5,
          totalDeliveredReach: '100000',
          totalDeliveredEngagement: '4000',
        });
      }
      return Promise.resolve({
        deliveredCreatorCount: 3,
        totalDeliveredReach: '50000',
        totalDeliveredEngagement: '2000',
      });
    });

    await processor.handle(makeJob('rpt-1'));

    expect(campaignRepo.find).toHaveBeenCalledWith({ where: { accountId: 'acct-client-1' } });
    const saved = reportRepo.save.mock.calls[0][0];
    expect(saved.campaignCount).toBe(2);
    expect(saved.totalSpend).toBe('180000.00');
    expect(saved.totalDeliveredReach).toBe(150000);
    expect(saved.totalDeliveredEngagement).toBe(6000);
  });

  it('marks the report failed, without throwing, when generation errors out', async () => {
    campaignRepo.find.mockRejectedValue(new Error('db unavailable'));

    await processor.handle(makeJob('rpt-1'));

    expect(reportRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: PerformanceReportStatus.FAILED }),
    );
  });
});
