import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ReviewQueueService } from './review-queue.service';
import { ReviewItemStatus, ReviewReasonCategory } from '../database/entities';

const mockRepo = () => ({
  findOne: vi.fn(),
  find: vi.fn().mockResolvedValue([]),
  save: vi.fn((entity: any) => Promise.resolve({ ...entity })),
  createQueryBuilder: vi.fn(),
});

function mockQb(getMany: any[] = [], getOne: any = null) {
  return {
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    getMany: vi.fn().mockResolvedValue(getMany),
    getOne: vi.fn().mockResolvedValue(getOne),
  };
}

const actor = { userId: 'user-1', ipAddress: '127.0.0.1', userAgent: 'vitest' };

describe('ReviewQueueService - US-17', () => {
  let service: ReviewQueueService;
  let reviewRepo: ReturnType<typeof mockRepo>;
  let submissionRepo: ReturnType<typeof mockRepo>;
  let checkRepo: ReturnType<typeof mockRepo>;
  let triggerRepo: ReturnType<typeof mockRepo>;
  let ruleRepo: ReturnType<typeof mockRepo>;
  let campaignRepo: ReturnType<typeof mockRepo>;
  let creatorRepo: ReturnType<typeof mockRepo>;
  let auditService: { log: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    reviewRepo = mockRepo();
    submissionRepo = mockRepo();
    checkRepo = mockRepo();
    triggerRepo = mockRepo();
    ruleRepo = mockRepo();
    campaignRepo = mockRepo();
    creatorRepo = mockRepo();
    auditService = { log: vi.fn().mockResolvedValue(undefined) };

    service = new ReviewQueueService(
      reviewRepo as any,
      submissionRepo as any,
      checkRepo as any,
      triggerRepo as any,
      ruleRepo as any,
      campaignRepo as any,
      creatorRepo as any,
      auditService as any,
    );
  });

  // US-17 scenario 2: a submission triggering more than one rule lists
  // every rule triggered, not just the first one found.
  it('lists every triggered rule on a queue item, not just the first', async () => {
    const item = {
      id: 'rq-001',
      contentSubmissionId: 'sub-1',
      campaignId: 'camp-1',
      safetyCheckId: 'chk-1',
      reasonCategory: ReviewReasonCategory.RULE_VIOLATION,
      status: ReviewItemStatus.PENDING,
      createdAt: new Date(),
    };
    reviewRepo.createQueryBuilder.mockReturnValue(mockQb([item]));
    submissionRepo.findOne.mockResolvedValue({ id: 'sub-1', creatorId: 'creator-1', campaignId: 'camp-1' });
    campaignRepo.findOne.mockResolvedValue({ id: 'camp-1', name: 'Lancamento Serum' });
    creatorRepo.findOne.mockResolvedValue({ id: 'creator-1', displayName: 'Duda Oliveira' });
    triggerRepo.find.mockResolvedValue([
      { ruleId: 'rule-007', channel: 'audio', matchedExcerpt: 'resultado garantido em uma semana' },
      { ruleId: 'rule-009', channel: 'caption', matchedExcerpt: 'testado em animais' },
    ]);
    ruleRepo.find.mockResolvedValue([
      { id: 'rule-007', ruleType: 'restricted_language' },
      { id: 'rule-009', ruleType: 'prohibited_topic' },
    ]);

    const result = await service.list('account-1');

    expect(result.data).toHaveLength(1);
    expect(result.data[0].triggered_rules).toHaveLength(2);
    const ruleIds = result.data[0].triggered_rules.map((t: any) => t.rule_id);
    expect(ruleIds).toEqual(['rule-007', 'rule-009']);
  });

  // US-17 scenario 3: a degraded queue returns a clear error, never a blank
  // or misleadingly empty list.
  it('returns 503 REVIEW_QUEUE_UNAVAILABLE when the list query fails unexpectedly', async () => {
    reviewRepo.createQueryBuilder.mockImplementation(() => {
      throw new Error('connection terminated unexpectedly');
    });

    await expect(service.list('account-1')).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(service.list('account-1')).rejects.toMatchObject({
      response: { error: { code: 'REVIEW_QUEUE_UNAVAILABLE' } },
    });
  });

  it('returns 503 REVIEW_QUEUE_UNAVAILABLE when getDetail fails unexpectedly', async () => {
    reviewRepo.createQueryBuilder.mockImplementation(() => {
      throw new Error('db down');
    });
    await expect(service.getDetail('rq-001', 'account-1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  // A genuine 404 (the item does not exist / is not in this account) is not
  // the same failure as the queue being unreachable, and must not be masked
  // as a 503.
  it('does not mask a real not-found as a 503', async () => {
    reviewRepo.createQueryBuilder.mockReturnValue(mockQb([], null));
    await expect(service.getDetail('missing', 'account-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('requires a reason for a non-approved decision (REASON_REQUIRED)', async () => {
    const item = { id: 'rq-001', status: ReviewItemStatus.PENDING, safetyCheckId: 'chk-1' };
    reviewRepo.createQueryBuilder.mockReturnValue(mockQb([], item));

    await expect(
      service.decide('rq-001', 'account-1', { decision: 'rejected' } as any, actor),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(reviewRepo.save).not.toHaveBeenCalled();
  });

  it('rejects a second decision attempt on an already-decided item (ALREADY_DECIDED)', async () => {
    const item = { id: 'rq-001', status: ReviewItemStatus.APPROVED, safetyCheckId: 'chk-1' };
    reviewRepo.createQueryBuilder.mockReturnValue(mockQb([], item));

    await expect(
      service.decide('rq-001', 'account-1', { decision: 'approved' }, actor),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  // ADR-0023: a human decision never mutates the automated verdict --
  // decide() has no dependency on safety_check at all, structurally.
  it('decides an item without ever touching safety_check', async () => {
    const item = {
      id: 'rq-001',
      status: ReviewItemStatus.PENDING,
      safetyCheckId: 'chk-1',
      contentSubmissionId: 'sub-1',
      campaignId: 'camp-1',
    };
    reviewRepo.createQueryBuilder.mockReturnValue(mockQb([], item));
    triggerRepo.find.mockResolvedValue([{ ruleId: 'rule-007', channel: 'audio', matchedExcerpt: 'x' }]);

    const result = await service.decide(
      'rq-001',
      'account-1',
      { decision: 'approved' },
      actor,
    );

    expect(result.status).toBe(ReviewItemStatus.APPROVED);
    expect(checkRepo.save).not.toHaveBeenCalled();
    expect(reviewRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: ReviewItemStatus.APPROVED, decidedByUserId: 'user-1' }),
    );
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'safety_review.decided' }),
    );
  });
});
