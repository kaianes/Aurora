import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GenerateCampaignReportProcessor } from './generate-campaign-report.processor';
import { CampaignProgressLabel, CampaignState, PerformanceReportStatus, SpendSource } from '../database/entities';

const mockRepo = () => ({
  findOne: vi.fn(),
  save: vi.fn((entity: any) => Promise.resolve(entity)),
});

function job(data: any) {
  return { data } as any;
}

describe('GenerateCampaignReportProcessor - US-22 (ADR-0046)', () => {
  let processor: GenerateCampaignReportProcessor;
  let reportRepo: ReturnType<typeof mockRepo>;
  let campaignRepo: ReturnType<typeof mockRepo>;
  let aggregateRepo: ReturnType<typeof mockRepo>;
  let invoiceRepo: ReturnType<typeof mockRepo>;
  let auditService: { log: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    reportRepo = mockRepo();
    campaignRepo = mockRepo();
    aggregateRepo = mockRepo();
    invoiceRepo = mockRepo();
    auditService = { log: vi.fn().mockResolvedValue(undefined) };

    processor = new GenerateCampaignReportProcessor(
      reportRepo as any,
      campaignRepo as any,
      aggregateRepo as any,
      invoiceRepo as any,
      auditService as any,
    );

    reportRepo.findOne.mockResolvedValue({ id: 'rpt-1', campaignId: 'camp-1', requestedByUserId: 'user-1' });
    invoiceRepo.findOne.mockResolvedValue(undefined);
  });

  // ---- US-22 scenario 1 + ADR-0046: both cost-efficiency figures computed
  // as simple divisions when there are deliveries ----
  it('computes cost_per_engagement and cpm_equivalent when there are deliveries, using locked_price as spend', async () => {
    campaignRepo.findOne.mockResolvedValue({
      accountId: 'acct-1',
      state: CampaignState.ACTIVE,
      lockedPrice: '45000.00',
    });
    aggregateRepo.findOne.mockResolvedValue({
      deliveredCreatorCount: 35,
      totalDeliveredReach: '1230000',
      totalDeliveredEngagement: '45210',
    });

    await processor.handle(job({ reportId: 'rpt-1' }));

    const saved = reportRepo.save.mock.calls[0][0];
    expect(saved.status).toBe(PerformanceReportStatus.READY);
    expect(saved.hasDeliveries).toBe(true);
    expect(saved.spendSource).toBe(SpendSource.LOCKED_PRICE);
    expect(saved.campaignProgressLabel).toBe(CampaignProgressLabel.IN_PROGRESS);
    expect(saved.costPerEngagement).toBe((45000 / 45210).toFixed(4));
    expect(saved.cpmEquivalent).toBe(((45000 / 1230000) * 1000).toFixed(2));
  });

  it('uses the invoice total, not locked_price, once an invoice has been generated', async () => {
    campaignRepo.findOne.mockResolvedValue({
      accountId: 'acct-1',
      state: CampaignState.COMPLETED,
      lockedPrice: '45000.00',
    });
    invoiceRepo.findOne.mockResolvedValue({ totalAmount: '43000.00' });
    aggregateRepo.findOne.mockResolvedValue({
      deliveredCreatorCount: 35,
      totalDeliveredReach: '1000000',
      totalDeliveredEngagement: '40000',
    });

    await processor.handle(job({ reportId: 'rpt-1' }));

    const saved = reportRepo.save.mock.calls[0][0];
    expect(saved.spendSource).toBe(SpendSource.INVOICE);
    expect(saved.spendAmount).toBe('43000.00');
    expect(saved.campaignProgressLabel).toBe(CampaignProgressLabel.FINAL);
  });

  // ---- US-22 scenario 3: no fabricated placeholder figures when nobody
  // has delivered yet ----
  it('reports has_deliveries false and null cost-efficiency figures when no creator has delivered', async () => {
    campaignRepo.findOne.mockResolvedValue({
      accountId: 'acct-1',
      state: CampaignState.ACTIVE,
      lockedPrice: '45000.00',
    });
    aggregateRepo.findOne.mockResolvedValue({
      deliveredCreatorCount: 0,
      totalDeliveredReach: '0',
      totalDeliveredEngagement: '0',
    });

    await processor.handle(job({ reportId: 'rpt-1' }));

    const saved = reportRepo.save.mock.calls[0][0];
    expect(saved.hasDeliveries).toBe(false);
    expect(saved.totalDeliveredReach).toBeNull();
    expect(saved.totalDeliveredEngagement).toBeNull();
    expect(saved.costPerEngagement).toBeNull();
    expect(saved.cpmEquivalent).toBeNull();
    expect(saved.spendAmount).toBe('45000.00'); // spend is already known, even with no deliveries
  });

  it('never divides by zero: null cost-efficiency when reach/engagement are both zero despite deliveries existing', async () => {
    campaignRepo.findOne.mockResolvedValue({
      accountId: 'acct-1',
      state: CampaignState.ACTIVE,
      lockedPrice: '45000.00',
    });
    aggregateRepo.findOne.mockResolvedValue({
      deliveredCreatorCount: 1,
      totalDeliveredReach: '0',
      totalDeliveredEngagement: '0',
    });

    await processor.handle(job({ reportId: 'rpt-1' }));

    const saved = reportRepo.save.mock.calls[0][0];
    expect(saved.hasDeliveries).toBe(true);
    expect(saved.costPerEngagement).toBeNull();
    expect(saved.cpmEquivalent).toBeNull();
  });

  it('marks the report failed, never leaving it pending forever, on an unexpected error', async () => {
    campaignRepo.findOne.mockRejectedValue(new Error('db unavailable'));

    await processor.handle(job({ reportId: 'rpt-1' }));

    const saved = reportRepo.save.mock.calls[0][0];
    expect(saved.status).toBe(PerformanceReportStatus.FAILED);
  });
});
