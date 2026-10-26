import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { DraftSubmissionService } from './draft-submission.service';
import { CampaignState, ContentReviewDecisionValue, OpportunityStatus } from '../database/entities';

const mockRepo = () => ({
  findOne: vi.fn(),
  find: vi.fn().mockResolvedValue([]),
  createQueryBuilder: vi.fn(),
});

const actor = { ipAddress: '127.0.0.1', userAgent: 'vitest' };

function mockQb(getMany: any[] = []) {
  return {
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    getMany: vi.fn().mockResolvedValue(getMany),
  };
}

describe('DraftSubmissionService - US-32a/US-32b/US-33', () => {
  let service: DraftSubmissionService;
  let campaignRepo: ReturnType<typeof mockRepo>;
  let opportunityRepo: ReturnType<typeof mockRepo>;
  let submissionRepo: ReturnType<typeof mockRepo>;
  let decisionRepo: ReturnType<typeof mockRepo>;
  let creatorRepo: ReturnType<typeof mockRepo>;
  let contentSubmissionService: { createSubmission: ReturnType<typeof vi.fn> };
  let gateService: { getGateStatus: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    campaignRepo = mockRepo();
    opportunityRepo = mockRepo();
    submissionRepo = mockRepo();
    decisionRepo = mockRepo();
    creatorRepo = mockRepo();
    contentSubmissionService = { createSubmission: vi.fn().mockResolvedValue({ content_submission_id: 'sub-2' }) };
    gateService = { getGateStatus: vi.fn().mockResolvedValue({ cleared: true, blockingReason: null }) };

    service = new DraftSubmissionService(
      campaignRepo as any,
      opportunityRepo as any,
      submissionRepo as any,
      decisionRepo as any,
      creatorRepo as any,
      contentSubmissionService as any,
      gateService as any,
    );
  });

  describe('createDraft', () => {
    const dto = { campaign_id: 'camp-1', opportunity_id: 'opp-1', caption_text: 'ola' };

    it('refuses with OPPORTUNITY_NOT_FOUND when there is no accepted opportunity (US-32a scenario 3)', async () => {
      opportunityRepo.findOne.mockResolvedValue(undefined);
      await expect(service.createDraft(dto as any, 'creator-1', actor)).rejects.toMatchObject({
        response: { error: { code: 'OPPORTUNITY_NOT_FOUND' } },
      });
      expect(contentSubmissionService.createSubmission).not.toHaveBeenCalled();
    });

    it('refuses with CAMPAIGN_NOT_ACTIVE when the campaign is paused or cancelled (US-32a scenario 3)', async () => {
      opportunityRepo.findOne.mockResolvedValue({ id: 'opp-1', status: OpportunityStatus.ACCEPTED });
      campaignRepo.findOne.mockResolvedValue({ id: 'camp-1', state: CampaignState.PAUSED });

      await expect(service.createDraft(dto as any, 'creator-1', actor)).rejects.toMatchObject({
        response: { error: { code: 'CAMPAIGN_NOT_ACTIVE' } },
      });
      expect(contentSubmissionService.createSubmission).not.toHaveBeenCalled();
    });

    it('accepts a first draft against an accepted opportunity on an active campaign (US-32a scenario 1)', async () => {
      opportunityRepo.findOne.mockResolvedValue({ id: 'opp-1', status: OpportunityStatus.ACCEPTED });
      campaignRepo.findOne.mockResolvedValue({ id: 'camp-1', state: CampaignState.ACTIVE });
      submissionRepo.findOne.mockResolvedValue(undefined);

      const result = await service.createDraft(dto as any, 'creator-1', actor);

      expect(contentSubmissionService.createSubmission).toHaveBeenCalledWith(
        dto,
        'creator-1',
        actor,
        expect.objectContaining({ supersedesSubmissionId: null }),
      );
      expect(result).toEqual({ content_submission_id: 'sub-2' });
    });

    it('refuses a resubmission while the latest version is still pending (409 PENDING_REVIEW_IN_PROGRESS)', async () => {
      opportunityRepo.findOne.mockResolvedValue({ id: 'opp-1', status: OpportunityStatus.ACCEPTED });
      campaignRepo.findOne.mockResolvedValue({ id: 'camp-1', state: CampaignState.ACTIVE });
      submissionRepo.findOne.mockResolvedValue({ id: 'sub-1', versionNumber: 1 });
      decisionRepo.findOne.mockResolvedValue(undefined);

      await expect(service.createDraft(dto as any, 'creator-1', actor)).rejects.toMatchObject({
        response: { error: { code: 'PENDING_REVIEW_IN_PROGRESS' } },
      });
    });

    it('refuses a resubmission once the latest version is already approved (409 ALREADY_APPROVED)', async () => {
      opportunityRepo.findOne.mockResolvedValue({ id: 'opp-1', status: OpportunityStatus.ACCEPTED });
      campaignRepo.findOne.mockResolvedValue({ id: 'camp-1', state: CampaignState.ACTIVE });
      submissionRepo.findOne.mockResolvedValue({ id: 'sub-1', versionNumber: 1 });
      decisionRepo.findOne.mockResolvedValue({ decision: ContentReviewDecisionValue.APPROVED });

      await expect(service.createDraft(dto as any, 'creator-1', actor)).rejects.toMatchObject({
        response: { error: { code: 'ALREADY_APPROVED' } },
      });
    });

    it('accepts a resubmission after rejection, linking it to the version it supersedes (US-32a scenario 2)', async () => {
      opportunityRepo.findOne.mockResolvedValue({ id: 'opp-1', status: OpportunityStatus.ACCEPTED });
      campaignRepo.findOne.mockResolvedValue({ id: 'camp-1', state: CampaignState.ACTIVE });
      submissionRepo.findOne.mockResolvedValue({ id: 'sub-1', versionNumber: 1 });
      decisionRepo.findOne.mockResolvedValue({ decision: ContentReviewDecisionValue.REJECTED });

      await service.createDraft(dto as any, 'creator-1', actor);

      expect(contentSubmissionService.createSubmission).toHaveBeenCalledWith(
        dto,
        'creator-1',
        actor,
        expect.objectContaining({ supersedesSubmissionId: 'sub-1' }),
      );
    });

    it('accepts a resubmission after revision_requested too', async () => {
      opportunityRepo.findOne.mockResolvedValue({ id: 'opp-1', status: OpportunityStatus.ACCEPTED });
      campaignRepo.findOne.mockResolvedValue({ id: 'camp-1', state: CampaignState.ACTIVE });
      submissionRepo.findOne.mockResolvedValue({ id: 'sub-1', versionNumber: 1 });
      decisionRepo.findOne.mockResolvedValue({ decision: ContentReviewDecisionValue.REVISION_REQUESTED });

      await service.createDraft(dto as any, 'creator-1', actor);

      expect(contentSubmissionService.createSubmission).toHaveBeenCalledWith(
        dto,
        'creator-1',
        actor,
        expect.objectContaining({ supersedesSubmissionId: 'sub-1' }),
      );
    });

    // US-32a scenario 2 / ADR-0025 section 3.3: the resubmission precondition must be checked
    // against the lineage's highest version_number, never a stale earlier one -- this asserts
    // the query that resolves "latest" is explicitly ordered descending by version_number rather
    // than relying on insertion order or an unordered find.
    it('resolves the latest version by version_number descending, not insertion order', async () => {
      opportunityRepo.findOne.mockResolvedValue({ id: 'opp-1', status: OpportunityStatus.ACCEPTED });
      campaignRepo.findOne.mockResolvedValue({ id: 'camp-1', state: CampaignState.ACTIVE });
      submissionRepo.findOne.mockResolvedValue({ id: 'sub-2', versionNumber: 2 });
      decisionRepo.findOne.mockResolvedValue({ decision: ContentReviewDecisionValue.REJECTED });

      await service.createDraft(dto as any, 'creator-1', actor);

      expect(submissionRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { opportunityId: 'opp-1' },
          order: { versionNumber: 'DESC' },
        }),
      );
    });

    // US-32b / ADR-0030: escalation is a visibility-only flag, never an auto-action. A pending
    // version that has been escalated must still block resubmission exactly as an un-escalated
    // pending version would -- escalation does not implicitly unlock or change the resubmission
    // precondition.
    it('still refuses resubmission with PENDING_REVIEW_IN_PROGRESS even when the pending version has been escalated', async () => {
      opportunityRepo.findOne.mockResolvedValue({ id: 'opp-1', status: OpportunityStatus.ACCEPTED });
      campaignRepo.findOne.mockResolvedValue({ id: 'camp-1', state: CampaignState.ACTIVE });
      submissionRepo.findOne.mockResolvedValue({
        id: 'sub-1',
        versionNumber: 1,
        reviewEscalated: true,
        reviewEscalatedAt: new Date(),
      });
      decisionRepo.findOne.mockResolvedValue(undefined);

      await expect(service.createDraft(dto as any, 'creator-1', actor)).rejects.toMatchObject({
        response: { error: { code: 'PENDING_REVIEW_IN_PROGRESS' } },
      });
      expect(contentSubmissionService.createSubmission).not.toHaveBeenCalled();
    });
  });

  describe('listForCreator', () => {
    it('requires opportunity_id', async () => {
      await expect(service.listForCreator('creator-1', '')).rejects.toMatchObject({
        response: { error: { code: 'OPPORTUNITY_ID_REQUIRED' } },
      });
    });

    it('scopes the lineage to the requesting creator only (404 if not their own)', async () => {
      opportunityRepo.findOne.mockResolvedValue(undefined);
      await expect(service.listForCreator('creator-1', 'opp-1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lists every version ordered, each attributed its own review status and reason (US-33 scenario 2)', async () => {
      opportunityRepo.findOne.mockResolvedValue({ id: 'opp-1', creatorId: 'creator-1' });
      submissionRepo.find.mockResolvedValue([
        {
          id: 'sub-1',
          versionNumber: 1,
          supersedesSubmissionId: null,
          reviewDeadlineAt: new Date(),
          reviewEscalated: false,
          publishedUrl: null,
          submittedAt: new Date(),
        },
        {
          id: 'sub-2',
          versionNumber: 2,
          supersedesSubmissionId: 'sub-1',
          reviewDeadlineAt: new Date(),
          reviewEscalated: false,
          publishedUrl: null,
          submittedAt: new Date(),
        },
      ]);
      decisionRepo.findOne.mockImplementation(({ where }: any) =>
        Promise.resolve(
          where.contentSubmissionId === 'sub-1'
            ? { decision: ContentReviewDecisionValue.REJECTED, decisionReason: 'Produto nao aparece.', decidedAt: new Date() }
            : undefined,
        ),
      );

      const result = await service.listForCreator('creator-1', 'opp-1');
      expect(result.data).toHaveLength(2);
      expect(result.data[0]).toMatchObject({ review_status: 'rejected', review_reason: 'Produto nao aparece.' });
      expect(result.data[1]).toMatchObject({ review_status: 'pending', review_reason: null });
    });
  });

  describe('listForBrand', () => {
    it('marks only the highest version_number in a lineage as latest_version', async () => {
      campaignRepo.findOne.mockResolvedValue({ id: 'camp-1', accountId: 'account-1' });
      const qb = mockQb([
        {
          id: 'sub-1',
          campaignId: 'camp-1',
          creatorId: 'creator-1',
          rootSubmissionId: 'sub-1',
          versionNumber: 1,
          supersedesSubmissionId: null,
          reviewDeadlineAt: null,
          reviewEscalated: false,
          publishedUrl: null,
          submittedAt: new Date(),
        },
      ]);
      submissionRepo.createQueryBuilder.mockReturnValue(qb);
      decisionRepo.findOne.mockResolvedValue(undefined);
      submissionRepo.findOne.mockResolvedValue({ id: 'sub-2', versionNumber: 2 });
      creatorRepo.findOne.mockResolvedValue({ displayName: 'Duda' });

      const result = await service.listForBrand('camp-1', 'account-1', {});
      expect(result.data[0].latest_version).toBe(false);
      expect(result.data[0].creator_display_name).toBe('Duda');
    });
  });
});
