import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnprocessableEntityException } from '@nestjs/common';
import { PayoutObligationService } from './payout-obligation.service';
import { OpportunityStatus, PayoutObligationStatus } from '../database/entities';

const mockRepo = () => ({
  findOne: vi.fn(),
  find: vi.fn().mockResolvedValue([]),
  count: vi.fn().mockResolvedValue(0),
  save: vi.fn((entity: any) => Promise.resolve(Array.isArray(entity) ? entity : { ...entity, id: entity.id || 'generated-id' })),
  create: vi.fn((data: any) => ({ ...data })),
  createQueryBuilder: vi.fn(),
});

const actor = { ipAddress: '127.0.0.1', userAgent: 'vitest' };

describe('PayoutObligationService - US-35a/b/c', () => {
  let service: PayoutObligationService;
  let obligationRepo: ReturnType<typeof mockRepo>;
  let attemptRepo: ReturnType<typeof mockRepo>;
  let opportunityRepo: ReturnType<typeof mockRepo>;
  let campaignRepo: ReturnType<typeof mockRepo>;
  let accountRepo: ReturnType<typeof mockRepo>;
  let creatorRepo: ReturnType<typeof mockRepo>;
  let ledgerService: { recordBalancedEntry: ReturnType<typeof vi.fn> };
  let auditService: { log: ReturnType<typeof vi.fn> };
  let configService: { get: ReturnType<typeof vi.fn> };
  let paymentsQueue: { add: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    obligationRepo = mockRepo();
    attemptRepo = mockRepo();
    opportunityRepo = mockRepo();
    campaignRepo = mockRepo();
    accountRepo = mockRepo();
    creatorRepo = mockRepo();
    ledgerService = { recordBalancedEntry: vi.fn().mockResolvedValue(undefined) };
    auditService = { log: vi.fn().mockResolvedValue(undefined) };
    configService = { get: vi.fn().mockReturnValue(undefined) };
    paymentsQueue = { add: vi.fn().mockResolvedValue(undefined) };

    service = new PayoutObligationService(
      obligationRepo as any,
      attemptRepo as any,
      opportunityRepo as any,
      campaignRepo as any,
      accountRepo as any,
      creatorRepo as any,
      ledgerService as any,
      auditService as any,
      configService as any,
      paymentsQueue as any,
    );
  });

  const baseInput = {
    contentSubmissionId: 'sub-1',
    campaignId: 'camp-1',
    creatorId: 'creator-1',
    opportunityId: 'opp-1',
    publishedAt: new Date('2026-10-20T00:00:00Z'),
  };

  // ---- US-35a scenario 1 ----
  it('creates exactly one obligation, copying the opportunity figures and computing the deadline', async () => {
    obligationRepo.findOne.mockResolvedValue(undefined);
    opportunityRepo.findOne.mockResolvedValue({
      id: 'opp-1',
      status: OpportunityStatus.ACCEPTED,
      payoutGross: '800.00',
      payoutCommission: '120.00',
      payoutNet: '680.00',
    });

    const result = await service.createForConfirmedPublication(baseInput);

    expect(result.alreadyExisted).toBe(false);
    expect(obligationRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        payoutGross: '800.00',
        payoutCommission: '120.00',
        payoutNet: '680.00',
        status: PayoutObligationStatus.OWED,
      }),
    );
    expect(paymentsQueue.add).toHaveBeenCalledWith(
      'attempt-payout-execution',
      expect.objectContaining({ payoutObligationId: expect.any(String) }),
    );
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'payout_obligation.created' }),
    );

    const saved = obligationRepo.save.mock.calls[0][0];
    const expectedDeadline = new Date('2026-10-25T00:00:00Z'); // + 5 days default
    expect(saved.committedDeadlineAt.toISOString()).toBe(expectedDeadline.toISOString());
  });

  // ---- US-35a scenario 2 ----
  it('is idempotent: a redelivered call for an existing submission never creates a duplicate', async () => {
    obligationRepo.findOne.mockResolvedValue({ id: 'existing-pay-1', contentSubmissionId: 'sub-1' });

    const result = await service.createForConfirmedPublication(baseInput);

    expect(result).toEqual({ payoutObligationId: 'existing-pay-1', alreadyExisted: true });
    expect(obligationRepo.save).not.toHaveBeenCalled();
    expect(paymentsQueue.add).not.toHaveBeenCalled();
  });

  it('recovers from a concurrent-insert race as idempotent, not as an error', async () => {
    obligationRepo.findOne
      .mockResolvedValueOnce(undefined) // no existing row seen before insert
      .mockResolvedValueOnce({ id: 'race-winner', contentSubmissionId: 'sub-1' }); // found after conflict
    opportunityRepo.findOne.mockResolvedValue({
      id: 'opp-1',
      status: OpportunityStatus.ACCEPTED,
      payoutGross: '800.00',
      payoutCommission: '120.00',
      payoutNet: '680.00',
    });
    obligationRepo.save.mockRejectedValueOnce({ code: '23505' });

    const result = await service.createForConfirmedPublication(baseInput);

    expect(result).toEqual({ payoutObligationId: 'race-winner', alreadyExisted: true });
  });

  // ---- US-35a scenario 3 ----
  it('refuses to create an obligation when published_at is missing, and logs why', async () => {
    obligationRepo.findOne.mockResolvedValue(undefined);

    await expect(
      service.createForConfirmedPublication({ ...baseInput, publishedAt: null }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);

    expect(obligationRepo.save).not.toHaveBeenCalled();
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'payout_obligation.creation_refused',
        metadata: expect.objectContaining({ reason: 'published_at_missing' }),
      }),
    );
  });

  it('refuses to create an obligation when the referenced opportunity is not accepted', async () => {
    obligationRepo.findOne.mockResolvedValue(undefined);
    opportunityRepo.findOne.mockResolvedValue({ id: 'opp-1', status: OpportunityStatus.PENDING });

    await expect(service.createForConfirmedPublication(baseInput)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(obligationRepo.save).not.toHaveBeenCalled();
  });

  // ---- US-35b/c: operator manual fallback ----
  it('markSettledManually writes the ledger pair, settles the obligation, and enqueues tax-document generation', async () => {
    const obligation = {
      id: 'pay-1',
      status: PayoutObligationStatus.OWED,
      campaignId: 'camp-1',
      creatorId: 'creator-1',
      payoutNet: '680.00',
      committedDeadlineAt: new Date('2026-10-28T00:00:00Z'),
      createdAt: new Date('2026-10-23T08:00:00Z'),
    };
    obligationRepo.findOne.mockResolvedValue(obligation);

    const result = await service.markSettledManually('pay-1', 'operator-1', 'manual-ref', actor);

    expect(ledgerService.recordBalancedEntry).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: 'camp-1', amount: '680.00' }),
    );
    expect(obligation.status).toBe(PayoutObligationStatus.SETTLED);
    expect(paymentsQueue.add).toHaveBeenCalledWith(
      'generate-tax-document',
      expect.objectContaining({ payoutObligationId: 'pay-1' }),
    );
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'payout_obligation.manually_settled' }),
    );
    expect(result).toBeDefined();
  });

  it('markSettledManually rejects an obligation that is already settled (ALREADY_SETTLED)', async () => {
    obligationRepo.findOne.mockResolvedValue({ id: 'pay-1', status: PayoutObligationStatus.SETTLED });

    await expect(
      service.markSettledManually('pay-1', 'operator-1', null, actor),
    ).rejects.toMatchObject({ response: { error: { code: 'ALREADY_SETTLED' } } });
    expect(ledgerService.recordBalancedEntry).not.toHaveBeenCalled();
  });

  it('markFailedManually leaves the obligation owed, sets failure fields, and enqueues notification', async () => {
    const obligation = {
      id: 'pay-1',
      status: PayoutObligationStatus.IN_FLIGHT,
      campaignId: 'camp-1',
      creatorId: 'creator-1',
      payoutNet: '680.00',
      firstFailureDetectedAt: null,
      committedDeadlineAt: new Date('2026-10-28T00:00:00Z'),
      createdAt: new Date('2026-10-23T08:00:00Z'),
    };
    obligationRepo.findOne.mockResolvedValue(obligation);

    await service.markFailedManually('pay-1', 'operator-1', 'Chave Pix invalida', actor);

    expect(obligation.status).toBe(PayoutObligationStatus.OWED);
    expect(obligation.firstFailureDetectedAt).not.toBeNull();
    expect(paymentsQueue.add).toHaveBeenCalledWith(
      'notify-payout-failure',
      expect.objectContaining({ payoutObligationId: 'pay-1', reason: 'Chave Pix invalida' }),
    );
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'payout_obligation.manually_failed' }),
    );
  });

  it('never overwrites first_failure_detected_at on a second failure (US-35c scenario 2)', async () => {
    const firstFailureAt = new Date('2026-10-20T10:00:00Z');
    const obligation = {
      id: 'pay-1',
      status: PayoutObligationStatus.OWED,
      campaignId: 'camp-1',
      creatorId: 'creator-1',
      payoutNet: '680.00',
      firstFailureDetectedAt: firstFailureAt,
      committedDeadlineAt: new Date('2026-10-28T00:00:00Z'),
      createdAt: new Date('2026-10-23T08:00:00Z'),
    };
    obligationRepo.findOne.mockResolvedValue(obligation);

    await service.markFailedManually('pay-1', 'operator-1', 'segunda falha', actor);

    expect(obligation.firstFailureDetectedAt).toEqual(firstFailureAt);
  });

  it('markFailedManually never reverts an already-settled obligation back to owed (NFR-13)', async () => {
    obligationRepo.findOne.mockResolvedValue({ id: 'pay-1', status: PayoutObligationStatus.SETTLED });

    await expect(
      service.markFailedManually('pay-1', 'operator-1', 'tentativa tardia', actor),
    ).rejects.toMatchObject({ response: { error: { code: 'ALREADY_SETTLED' } } });
    expect(paymentsQueue.add).not.toHaveBeenCalled();
  });

  it('getForCreator returns PAYOUT_OBLIGATION_NOT_FOUND for another creator\'s obligation', async () => {
    obligationRepo.findOne.mockResolvedValue(undefined);
    await expect(service.getForCreator('pay-1', 'creator-2')).rejects.toMatchObject({
      response: { error: { code: 'PAYOUT_OBLIGATION_NOT_FOUND' } },
    });
  });
});
