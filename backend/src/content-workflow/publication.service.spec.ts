import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PublicationService } from './publication.service';
import { ContentReviewDecisionValue } from '../database/entities';

const mockRepo = () => ({
  findOne: vi.fn(),
  save: vi.fn((entity: any) => Promise.resolve({ ...entity })),
});

const actor = { ipAddress: '127.0.0.1', userAgent: 'vitest' };

describe('PublicationService - US-34', () => {
  let service: PublicationService;
  let submissionRepo: ReturnType<typeof mockRepo>;
  let decisionRepo: ReturnType<typeof mockRepo>;
  let gateService: { getGateStatus: ReturnType<typeof vi.fn>; recordPublication: ReturnType<typeof vi.fn> };
  let linkVerifier: { verify: ReturnType<typeof vi.fn> };
  let auditService: { log: ReturnType<typeof vi.fn> };
  let payoutObligationService: { createForConfirmedPublication: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    submissionRepo = mockRepo();
    decisionRepo = mockRepo();
    gateService = {
      getGateStatus: vi.fn().mockResolvedValue({ cleared: true, blockingReason: null }),
      recordPublication: vi.fn().mockResolvedValue(undefined),
    };
    linkVerifier = { verify: vi.fn().mockResolvedValue({ resolved: true, matches: true }) };
    auditService = { log: vi.fn().mockResolvedValue(undefined) };
    payoutObligationService = {
      createForConfirmedPublication: vi
        .fn()
        .mockResolvedValue({ payoutObligationId: 'pay-1', alreadyExisted: false }),
    };

    submissionRepo.findOne.mockResolvedValue({
      id: 'sub-1',
      creatorId: 'creator-1',
      campaignId: 'camp-1',
      opportunityId: 'opp-1',
      captionText: 'ola mundo',
    });
    decisionRepo.findOne.mockResolvedValue({ decision: ContentReviewDecisionValue.APPROVED });

    service = new PublicationService(
      submissionRepo as any,
      decisionRepo as any,
      gateService as any,
      linkVerifier as any,
      auditService as any,
      payoutObligationService as any,
    );
  });

  const dto = { published_url: 'https://instagram.com/p/abc123' };

  it('confirms publication when approved, cleared, and matching (US-34 scenario 1)', async () => {
    const result = await service.confirmPublication('sub-1', 'creator-1', dto, actor);
    expect(result.status).toBe('confirmed');
    expect(gateService.recordPublication).toHaveBeenCalledWith('sub-1', dto.published_url);
    expect(payoutObligationService.createForConfirmedPublication).toHaveBeenCalledWith(
      expect.objectContaining({ contentSubmissionId: 'sub-1', opportunityId: 'opp-1' }),
    );
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'content_submission.publication_confirmed' }),
    );
  });

  it('returns SUBMISSION_NOT_FOUND for a submission not owned by the caller', async () => {
    submissionRepo.findOne.mockResolvedValue(undefined);
    await expect(service.confirmPublication('sub-1', 'creator-1', dto, actor)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('refuses with DRAFT_NOT_APPROVED when no decision exists yet', async () => {
    decisionRepo.findOne.mockResolvedValue(undefined);
    await expect(service.confirmPublication('sub-1', 'creator-1', dto, actor)).rejects.toMatchObject({
      response: { error: { code: 'DRAFT_NOT_APPROVED' } },
    });
    expect(gateService.getGateStatus).not.toHaveBeenCalled();
  });

  it('refuses with DRAFT_NOT_APPROVED when the decision is rejected, not approved', async () => {
    decisionRepo.findOne.mockResolvedValue({ decision: ContentReviewDecisionValue.REJECTED });
    await expect(service.confirmPublication('sub-1', 'creator-1', dto, actor)).rejects.toMatchObject({
      response: { error: { code: 'DRAFT_NOT_APPROVED' } },
    });
  });

  it('refuses with SAFETY_NOT_CLEARED, echoing the blocking reason (US-34 scenario 3)', async () => {
    gateService.getGateStatus.mockResolvedValue({ cleared: false, blockingReason: 'flagged' });
    await expect(service.confirmPublication('sub-1', 'creator-1', dto, actor)).rejects.toMatchObject({
      response: { error: { code: 'SAFETY_NOT_CLEARED', details: { blocking_reason: 'flagged' } } },
    });
    expect(linkVerifier.verify).not.toHaveBeenCalled();
  });

  it('refuses with PUBLICATION_LINK_UNREACHABLE when the link does not resolve (US-34 scenario 3)', async () => {
    linkVerifier.verify.mockResolvedValue({ resolved: false });
    await expect(service.confirmPublication('sub-1', 'creator-1', dto, actor)).rejects.toMatchObject({
      response: { error: { code: 'PUBLICATION_LINK_UNREACHABLE' } },
    });
    expect(gateService.recordPublication).not.toHaveBeenCalled();
  });

  it('refuses with PUBLICATION_CONTENT_MISMATCH when the live content differs (US-34 scenario 2)', async () => {
    linkVerifier.verify.mockResolvedValue({ resolved: true, matches: false, fetchedCaptionText: 'outra legenda' });
    await expect(service.confirmPublication('sub-1', 'creator-1', dto, actor)).rejects.toMatchObject({
      response: { error: { code: 'PUBLICATION_CONTENT_MISMATCH', details: { field: 'caption_text' } } },
    });
    expect(gateService.recordPublication).not.toHaveBeenCalled();
  });

  it('never creates a confirmed publication record on any of the three failure paths', async () => {
    gateService.getGateStatus.mockResolvedValue({ cleared: false, blockingReason: 'pending' });
    await expect(service.confirmPublication('sub-1', 'creator-1', dto, actor)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(submissionRepo.save).not.toHaveBeenCalled();
  });
});
