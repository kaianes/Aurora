import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { TaxDocumentService } from './tax-document.service';
import { PayoutObligationStatus, TaxDocumentStatus } from '../database/entities';

const mockRepo = () => ({
  findOne: vi.fn(),
  save: vi.fn((entity: any) => Promise.resolve({ ...entity, id: entity.id || 'tax-doc-1' })),
  create: vi.fn((data: any) => ({ ...data })),
});

describe('TaxDocumentService - US-36b', () => {
  let service: TaxDocumentService;
  let taxDocumentRepo: ReturnType<typeof mockRepo>;
  let obligationRepo: ReturnType<typeof mockRepo>;
  let creatorRepo: ReturnType<typeof mockRepo>;
  let auditService: { log: ReturnType<typeof vi.fn> };
  let configService: { get: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    taxDocumentRepo = mockRepo();
    obligationRepo = mockRepo();
    creatorRepo = mockRepo();
    auditService = { log: vi.fn().mockResolvedValue(undefined) };
    configService = { get: vi.fn().mockReturnValue(undefined) };

    service = new TaxDocumentService(
      taxDocumentRepo as any,
      obligationRepo as any,
      creatorRepo as any,
      auditService as any,
      configService as any,
    );
  });

  // ---- US-36b scenario 1 ----
  it('generates a document when the creator has a tax_id on file', async () => {
    taxDocumentRepo.findOne.mockResolvedValue(undefined);
    obligationRepo.findOne.mockResolvedValue({
      id: 'pay-1',
      creatorId: 'creator-1',
      status: PayoutObligationStatus.SETTLED,
      settledAt: new Date('2026-10-28T00:00:00Z'),
    });
    creatorRepo.findOne.mockResolvedValue({ id: 'creator-1', taxId: '123.456.789-00', taxIdType: 'cpf' });

    const doc = await service.generateForSettledObligation('pay-1');

    expect(doc.status).toBe(TaxDocumentStatus.GENERATED);
    expect(doc.taxPeriod).toBe('2026-10');
    expect(doc.documentUrl).toContain('pay-1');
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'tax_document.generated' }),
    );
  });

  // ---- US-36b scenario 3 ----
  it('flags blocked_missing_info with tax_id named explicitly when the creator has no tax_id', async () => {
    taxDocumentRepo.findOne.mockResolvedValue(undefined);
    obligationRepo.findOne.mockResolvedValue({
      id: 'pay-1',
      creatorId: 'creator-1',
      status: PayoutObligationStatus.SETTLED,
      settledAt: new Date('2026-10-28T00:00:00Z'),
    });
    creatorRepo.findOne.mockResolvedValue({ id: 'creator-1', taxId: null, taxIdType: null });

    const doc = await service.generateForSettledObligation('pay-1');

    expect(doc.status).toBe(TaxDocumentStatus.BLOCKED_MISSING_INFO);
    expect(doc.missingFields).toEqual(['tax_id']);
    expect(doc.documentUrl).toBeNull();
  });

  // ---- US-36b scenario 2 ----
  it('is idempotent per obligation: a second call never regenerates or duplicates the document', async () => {
    const existing = { id: 'tax-doc-1', payoutObligationId: 'pay-1', status: TaxDocumentStatus.GENERATED };
    taxDocumentRepo.findOne.mockResolvedValue(existing);

    const doc = await service.generateForSettledObligation('pay-1');

    expect(doc).toBe(existing);
    expect(obligationRepo.findOne).not.toHaveBeenCalled();
    expect(taxDocumentRepo.save).not.toHaveBeenCalled();
  });

  it('getForCreator returns TAX_DOCUMENT_NOT_AVAILABLE for an obligation still owed', async () => {
    obligationRepo.findOne.mockResolvedValue({
      id: 'pay-1',
      creatorId: 'creator-1',
      status: PayoutObligationStatus.OWED,
    });

    await expect(service.getForCreator('pay-1', 'creator-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it("getForCreator returns TAX_DOCUMENT_NOT_AVAILABLE for an obligation that isn't the caller's own", async () => {
    obligationRepo.findOne.mockResolvedValue(undefined);

    await expect(service.getForCreator('pay-1', 'someone-else')).rejects.toMatchObject({
      response: { error: { code: 'TAX_DOCUMENT_NOT_AVAILABLE' } },
    });
  });

  it('getForCreator returns the blocked-with-message shape for a settled obligation with no tax_id', async () => {
    obligationRepo.findOne
      .mockResolvedValueOnce({ id: 'pay-1', creatorId: 'creator-1', status: PayoutObligationStatus.SETTLED })
      .mockResolvedValueOnce({
        id: 'pay-1',
        creatorId: 'creator-1',
        status: PayoutObligationStatus.SETTLED,
        settledAt: new Date('2026-10-28T00:00:00Z'),
      });
    taxDocumentRepo.findOne.mockResolvedValue(undefined);
    creatorRepo.findOne.mockResolvedValue({ id: 'creator-1', taxId: null });

    const response = await service.getForCreator('pay-1', 'creator-1');

    expect(response).toMatchObject({ status: TaxDocumentStatus.BLOCKED_MISSING_INFO, missing_fields: ['tax_id'] });
  });
});
