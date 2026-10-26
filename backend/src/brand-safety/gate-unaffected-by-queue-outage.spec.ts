import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { BrandSafetyGateService } from './brand-safety-gate.service';
import { ReviewQueueService } from './review-queue.service';
import { ReviewItemStatus, SafetyCheckStatus } from '../database/entities';

// US-17 scenario 3: "the flagged content remains in its flagged, unpublished state (per US-16
// scenario 3) until she can actually review it" even while the review queue itself is degraded.
// Section 2.8 of the E4 architecture doc states this is structurally true because the gate
// computation reads the safety_check/safety_review_queue_item tables directly, a separate read
// path from the review queue's own listing query -- it is not a property that depends on the
// queue being reachable. This spec exercises both services together, against the same flagged
// submission, to confirm that claim rather than assume it from the architecture doc's prose.
describe('US-17 scenario 3: the publication gate is unaffected by a review-queue outage', () => {
  let gateService: BrandSafetyGateService;
  let reviewQueueService: ReviewQueueService;

  // Shared repos: the gate's checkRepo/reviewRepo use plain findOne, independent of the review
  // queue's own createQueryBuilder-based list/getDetail path, which is the thing we are
  // deliberately breaking below.
  const submissionRepo = { findOne: vi.fn() };
  const checkRepo = { findOne: vi.fn() };
  const reviewRepoForGate = { findOne: vi.fn() };
  const snapshotRepo = { findOne: vi.fn(), save: vi.fn(), create: vi.fn() };

  const reviewRepoForQueue = {
    createQueryBuilder: vi.fn(),
    find: vi.fn().mockResolvedValue([]),
    save: vi.fn(),
  };
  const submissionRepoForQueue = { findOne: vi.fn() };
  const checkRepoForQueue = { findOne: vi.fn() };
  const triggerRepo = { find: vi.fn().mockResolvedValue([]) };
  const ruleRepo = { find: vi.fn().mockResolvedValue([]) };
  const campaignRepo = { findOne: vi.fn() };
  const creatorRepo = { findOne: vi.fn() };
  const auditService = { log: vi.fn().mockResolvedValue(undefined) };

  beforeEach(() => {
    vi.clearAllMocks();
    gateService = new BrandSafetyGateService(
      submissionRepo as any,
      checkRepo as any,
      reviewRepoForGate as any,
      snapshotRepo as any,
    );
    reviewQueueService = new ReviewQueueService(
      reviewRepoForQueue as any,
      submissionRepoForQueue as any,
      checkRepoForQueue as any,
      triggerRepo as any,
      ruleRepo as any,
      campaignRepo as any,
      creatorRepo as any,
      auditService as any,
    );

    // The submission is flagged and still awaiting a human decision -- the exact state US-17
    // scenario 3 says must survive a queue outage unchanged.
    checkRepo.findOne.mockResolvedValue({ id: 'chk-1', status: SafetyCheckStatus.FLAGGED });
    reviewRepoForGate.findOne.mockResolvedValue({ status: ReviewItemStatus.PENDING });

    // The review queue's own read path is degraded.
    reviewRepoForQueue.createQueryBuilder.mockImplementation(() => {
      throw new Error('connection terminated unexpectedly');
    });
  });

  it('keeps the submission blocked/flagged while the review queue list is unreachable', async () => {
    await expect(reviewQueueService.list('account-1')).rejects.toBeInstanceOf(ServiceUnavailableException);

    const gate = await gateService.getGateStatus('sub-1');
    expect(gate).toEqual({ cleared: false, blockingReason: 'flagged' });
  });

  it('refuses a publication attempt made during the same outage, never defaulting to cleared', async () => {
    submissionRepo.findOne.mockResolvedValue({ id: 'sub-1', captionText: 'caption' });

    await expect(reviewQueueService.getDetail('rq-1', 'account-1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    await expect(gateService.recordPublication('sub-1', 'https://instagram.com/p/abc')).rejects.toMatchObject({
      response: { error: { code: 'SAFETY_NOT_CLEARED' } },
    });
    expect(snapshotRepo.save).not.toHaveBeenCalled();
  });
});
