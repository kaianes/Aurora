import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ReviewDecisionService } from './review-decision.service';
import { ContentReviewDecisionValue } from '../database/entities';

const mockRepo = () => ({
  findOne: vi.fn(),
  create: vi.fn((data: any) => ({ ...data })),
  save: vi.fn((entity: any) =>
    Promise.resolve({ id: entity.id || 'rev-dec-1', createdAt: new Date(), ...entity }),
  ),
});

const actor = { userId: 'user-1', ipAddress: '127.0.0.1', userAgent: 'vitest' };

describe('ReviewDecisionService - US-19', () => {
  let service: ReviewDecisionService;
  let submissionRepo: ReturnType<typeof mockRepo>;
  let decisionRepo: ReturnType<typeof mockRepo>;
  let campaignRepo: ReturnType<typeof mockRepo>;
  let auditService: { log: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    submissionRepo = mockRepo();
    decisionRepo = mockRepo();
    campaignRepo = mockRepo();
    auditService = { log: vi.fn().mockResolvedValue(undefined) };

    submissionRepo.findOne.mockResolvedValue({ id: 'sub-1', campaignId: 'camp-1' });
    campaignRepo.findOne.mockResolvedValue({ id: 'camp-1', accountId: 'account-1' });

    service = new ReviewDecisionService(submissionRepo as any, decisionRepo as any, campaignRepo as any, auditService as any);
  });

  it('records an approval with no reason required (US-19 scenario 1)', async () => {
    decisionRepo.findOne.mockResolvedValue(undefined);
    const result = await service.decide('sub-1', 'account-1', { decision: 'approved' }, actor);
    expect(result.decision).toBe(ContentReviewDecisionValue.APPROVED);
  });

  it('refuses a rejection with no reason (422 REASON_REQUIRED, US-19 scenario 3)', async () => {
    decisionRepo.findOne.mockResolvedValue(undefined);
    await expect(
      service.decide('sub-1', 'account-1', { decision: 'rejected' }, actor),
    ).rejects.toMatchObject({ response: { error: { code: 'REASON_REQUIRED' } } });
    expect(decisionRepo.save).not.toHaveBeenCalled();
  });

  it('stores the reason atomically with the rejection, attached to this exact submission (US-19 scenario 2)', async () => {
    decisionRepo.findOne.mockResolvedValue(undefined);
    const result = await service.decide(
      'sub-1',
      'account-1',
      { decision: 'rejected', reason: 'O produto nao aparece.' },
      actor,
    );
    expect(result.content_submission_id).toBe('sub-1');
    expect(decisionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ decisionReason: 'O produto nao aparece.', contentSubmissionId: 'sub-1' }),
    );
  });

  it('refuses a second decision on the same submission (409 ALREADY_DECIDED)', async () => {
    decisionRepo.findOne.mockResolvedValue({ id: 'rev-dec-1' });
    await expect(service.decide('sub-1', 'account-1', { decision: 'approved' }, actor)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('returns SUBMISSION_NOT_FOUND for a submission outside the caller account', async () => {
    campaignRepo.findOne.mockResolvedValue(undefined);
    await expect(service.decide('sub-1', 'account-2', { decision: 'approved' }, actor)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  // US-32b / ADR-0030: escalation is visibility-only and must never block or alter Marina's
  // decision path -- a decision on an already-escalated submission still succeeds normally,
  // proving the escalation sweeper is not a gate this endpoint has to clear.
  it('still records a decision normally on a submission that has already been escalated', async () => {
    submissionRepo.findOne.mockResolvedValue({
      id: 'sub-1',
      campaignId: 'camp-1',
      reviewEscalated: true,
      reviewEscalatedAt: new Date(),
    });
    decisionRepo.findOne.mockResolvedValue(undefined);

    const result = await service.decide(
      'sub-1',
      'account-1',
      { decision: 'rejected', reason: 'Audio incompreensivel.' },
      actor,
    );

    expect(result.decision).toBe(ContentReviewDecisionValue.REJECTED);
    expect(decisionRepo.save).toHaveBeenCalled();
  });
});
