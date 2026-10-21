import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { InvoiceService } from './invoice.service';
import {
  CampaignState,
  ShortfallResolutionType,
  ShortfallChosenBy,
  InvoiceLineItemType,
} from '../database/entities';

const mockRepo = () => ({
  findOne: vi.fn(),
  find: vi.fn().mockResolvedValue([]),
  count: vi.fn().mockResolvedValue(0),
  save: vi.fn((entity: any) => Promise.resolve(Array.isArray(entity) ? entity : { ...entity, id: entity.id || 'inv-1' })),
  create: vi.fn((data: any) => ({ ...data })),
});

const actor = { userId: 'user-1', ipAddress: '127.0.0.1', userAgent: 'vitest' };

describe('InvoiceService - US-20/US-42', () => {
  let service: InvoiceService;
  let invoiceRepo: ReturnType<typeof mockRepo>;
  let lineItemRepo: ReturnType<typeof mockRepo>;
  let campaignRepo: ReturnType<typeof mockRepo>;
  let opportunityRepo: ReturnType<typeof mockRepo>;
  let shortfallRepo: ReturnType<typeof mockRepo>;
  let auditService: { log: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    invoiceRepo = mockRepo();
    lineItemRepo = mockRepo();
    campaignRepo = mockRepo();
    opportunityRepo = mockRepo();
    shortfallRepo = mockRepo();
    auditService = { log: vi.fn().mockResolvedValue(undefined) };

    service = new InvoiceService(
      invoiceRepo as any,
      lineItemRepo as any,
      campaignRepo as any,
      opportunityRepo as any,
      shortfallRepo as any,
      auditService as any,
    );

    campaignRepo.findOne.mockResolvedValue({
      id: 'camp-1',
      accountId: 'acct-1',
      state: CampaignState.ACTIVE,
      lockedPrice: '45000.00',
    });
    invoiceRepo.findOne.mockResolvedValue(undefined);
    shortfallRepo.findOne.mockResolvedValue(undefined);
  });

  // ---- US-20 scenario 1 ----
  it('generates a single invoice at the fixed locked price with a base_price line item', async () => {
    const result = await service.generate('camp-1', 'acct-1', actor);

    expect(result.total_amount).toBe('45000.00');
    expect(result.line_items).toHaveLength(1);
    expect(result.line_items[0]).toMatchObject({ line_type: InvoiceLineItemType.BASE_PRICE, amount: '45000.00' });
    expect(auditService.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'invoice.generated' }));
  });

  // ---- US-20 scenario 2 ----
  it('itemizes a resolved partial_refund shortfall as a negative adjustment line item on the same invoice', async () => {
    shortfallRepo.findOne.mockResolvedValue({
      campaignId: 'camp-1',
      resolutionType: ShortfallResolutionType.PARTIAL_REFUND,
      refundAmount: '8500.00',
      chosenBy: ShortfallChosenBy.BUYER,
      resolvedAt: new Date(),
    });

    const result = await service.generate('camp-1', 'acct-1', actor);

    expect(result.total_amount).toBe('36500.00');
    expect(result.line_items).toHaveLength(2);
    expect(result.line_items[1]).toMatchObject({
      line_type: InvoiceLineItemType.SHORTFALL_REFUND_ADJUSTMENT,
      amount: '-8500.00',
    });
  });

  it('produces no adjustment line item for a revised_guarantee resolution (never changes locked_price)', async () => {
    shortfallRepo.findOne.mockResolvedValue({
      campaignId: 'camp-1',
      resolutionType: ShortfallResolutionType.REVISED_GUARANTEE,
      revisedMinPoolSize: 3,
      chosenBy: ShortfallChosenBy.BUYER,
      resolvedAt: new Date(),
    });

    const result = await service.generate('camp-1', 'acct-1', actor);

    expect(result.line_items).toHaveLength(1);
    expect(result.total_amount).toBe('45000.00');
  });

  // ---- US-20 scenario 3 ----
  it('refuses with CAMPAIGN_NOT_BILLABLE when opportunities are still pending', async () => {
    opportunityRepo.count.mockResolvedValue(4);

    await expect(service.generate('camp-1', 'acct-1', actor)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    await expect(service.generate('camp-1', 'acct-1', actor)).rejects.toMatchObject({
      response: { error: { code: 'CAMPAIGN_NOT_BILLABLE', details: { pending_opportunities: 4 } } },
    });
    expect(invoiceRepo.save).not.toHaveBeenCalled();
  });

  it('refuses with CAMPAIGN_NOT_BILLABLE when the campaign has not reached a billable state', async () => {
    campaignRepo.findOne.mockResolvedValue({
      id: 'camp-1',
      accountId: 'acct-1',
      state: CampaignState.DRAFT,
      lockedPrice: null,
    });

    await expect(service.generate('camp-1', 'acct-1', actor)).rejects.toMatchObject({
      response: { error: { code: 'CAMPAIGN_NOT_BILLABLE' } },
    });
  });

  it('refuses a second invoice for the same campaign (INVOICE_ALREADY_GENERATED)', async () => {
    invoiceRepo.findOne.mockResolvedValue({ id: 'inv-1', campaignId: 'camp-1' });

    await expect(service.generate('camp-1', 'acct-1', actor)).rejects.toBeInstanceOf(ConflictException);
  });
});
