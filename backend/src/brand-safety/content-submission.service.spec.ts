import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { ContentSubmissionService } from './content-submission.service';
import { ExtractionStatus, SafetyCheckStatus } from '../database/entities';

const mockRepo = () => ({
  findOne: vi.fn(),
  find: vi.fn().mockResolvedValue([]),
  create: vi.fn((data: any) => ({ ...data })),
  save: vi.fn((entity: any) =>
    Promise.resolve({ id: entity.id || 'id-' + Math.random(), createdAt: new Date(), requestedAt: new Date(), ...entity }),
  ),
});

const actor = { ipAddress: '127.0.0.1', userAgent: 'vitest' };

describe('ContentSubmissionService - US-16', () => {
  let service: ContentSubmissionService;
  let campaignRepo: ReturnType<typeof mockRepo>;
  let opportunityRepo: ReturnType<typeof mockRepo>;
  let submissionRepo: ReturnType<typeof mockRepo>;
  let checkRepo: ReturnType<typeof mockRepo>;
  let triggerRepo: ReturnType<typeof mockRepo>;
  let ruleRepo: ReturnType<typeof mockRepo>;
  let queue: { add: ReturnType<typeof vi.fn> };
  let rulesetService: { resolveGoverningRulesetId: ReturnType<typeof vi.fn> };
  let auditService: { log: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    campaignRepo = mockRepo();
    opportunityRepo = mockRepo();
    submissionRepo = mockRepo();
    checkRepo = mockRepo();
    triggerRepo = mockRepo();
    ruleRepo = mockRepo();
    queue = { add: vi.fn().mockResolvedValue(undefined) };
    rulesetService = { resolveGoverningRulesetId: vi.fn().mockResolvedValue('ruleset-1') };
    auditService = { log: vi.fn().mockResolvedValue(undefined) };

    service = new ContentSubmissionService(
      campaignRepo as any,
      opportunityRepo as any,
      submissionRepo as any,
      checkRepo as any,
      triggerRepo as any,
      ruleRepo as any,
      queue as any,
      rulesetService as any,
      auditService as any,
    );
  });

  it('rejects an empty caption_text with 422 CAPTION_TEXT_REQUIRED', async () => {
    await expect(
      service.createSubmission({ campaign_id: 'camp-1', caption_text: '  ' } as any, 'creator-1', actor),
    ).rejects.toMatchObject({ response: { error: { code: 'CAPTION_TEXT_REQUIRED' } } });
    expect(submissionRepo.save).not.toHaveBeenCalled();
  });

  it('rejects a submission against an opportunity the creator does not hold accepted', async () => {
    campaignRepo.findOne.mockResolvedValue({ id: 'camp-1', accountId: 'account-1' });
    opportunityRepo.findOne.mockResolvedValue(undefined);

    await expect(
      service.createSubmission(
        { campaign_id: 'camp-1', opportunity_id: 'opp-1', caption_text: 'ola' },
        'creator-1',
        actor,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('enqueues extract-content-channels when only a media asset is supplied', async () => {
    campaignRepo.findOne.mockResolvedValue({ id: 'camp-1', accountId: 'account-1' });

    const result = await service.createSubmission(
      { campaign_id: 'camp-1', caption_text: 'ola', media_asset_url: 's3://bucket/video.mp4' },
      'creator-1',
      actor,
    );

    expect(queue.add).toHaveBeenCalledWith('extract-content-channels', expect.any(Object));
    expect(result.status).toBe(SafetyCheckStatus.PENDING);
  });

  it('enqueues run-safety-check directly when text channels are supplied with no media asset', async () => {
    campaignRepo.findOne.mockResolvedValue({ id: 'camp-1', accountId: 'account-1' });

    await service.createSubmission({ campaign_id: 'camp-1', caption_text: 'ola' }, 'creator-1', actor);

    expect(queue.add).toHaveBeenCalledWith('run-safety-check', expect.any(Object));
  });

  it('sets extraction_status not_required for a caption-only submission', async () => {
    campaignRepo.findOne.mockResolvedValue({ id: 'camp-1', accountId: 'account-1' });
    const saved: any[] = [];
    submissionRepo.save.mockImplementation((e: any) => {
      saved.push(e);
      return Promise.resolve({ id: 'sub-1', createdAt: new Date(), requestedAt: new Date(), ...e });
    });

    await service.createSubmission({ campaign_id: 'camp-1', caption_text: 'ola' }, 'creator-1', actor);
    expect(saved[0].extractionStatus).toBe(ExtractionStatus.NOT_REQUIRED);
  });

  describe('version lineage (ADR-0025, ADR-0032)', () => {
    it('defaults to a first-version shape when no options are passed (backward-compatible with E4 callers)', async () => {
      campaignRepo.findOne.mockResolvedValue({ id: 'camp-1', accountId: 'account-1' });

      const result = await service.createSubmission(
        { campaign_id: 'camp-1', caption_text: 'ola' },
        'creator-1',
        actor,
      );

      expect(result.version_number).toBe(1);
      expect(submissionRepo.save).toHaveBeenCalledTimes(2); // insert, then self-referencing root fixup
    });

    it('computes version_number and carries root_submission_id forward when supersedesSubmissionId is given', async () => {
      campaignRepo.findOne.mockResolvedValue({ id: 'camp-1', accountId: 'account-1' });
      submissionRepo.findOne.mockResolvedValue({ id: 'sub-1', versionNumber: 1, rootSubmissionId: 'sub-1' });

      const result = await service.createSubmission(
        { campaign_id: 'camp-1', caption_text: 'ola v2' },
        'creator-1',
        actor,
        { supersedesSubmissionId: 'sub-1' },
      );

      expect(result.version_number).toBe(2);
    });

    it('includes review_deadline_at in the response when provided', async () => {
      campaignRepo.findOne.mockResolvedValue({ id: 'camp-1', accountId: 'account-1' });
      const deadline = new Date('2026-10-23T09:00:00Z');

      const result = await service.createSubmission(
        { campaign_id: 'camp-1', caption_text: 'ola' },
        'creator-1',
        actor,
        { reviewDeadlineAt: deadline },
      );

      expect(result.review_deadline_at).toBe(deadline.toISOString());
    });
  });

  describe('getCheckStatus', () => {
    it('denies a creator polling a submission that is not theirs (404, no existence leak)', async () => {
      submissionRepo.findOne.mockResolvedValue({ id: 'sub-1', creatorId: 'creator-2' });
      await expect(
        service.getCheckStatus('sub-1', { isCreator: true, creatorId: 'creator-1' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('allows the submitting creator to poll their own submission', async () => {
      submissionRepo.findOne.mockResolvedValue({ id: 'sub-1', creatorId: 'creator-1' });
      checkRepo.findOne.mockResolvedValue({
        id: 'chk-1',
        status: SafetyCheckStatus.PENDING,
        requestedAt: new Date(),
      });

      const result = await service.getCheckStatus('sub-1', { isCreator: true, creatorId: 'creator-1' });
      expect(result.status).toBe(SafetyCheckStatus.PENDING);
    });

    it('includes triggered_rules in the response for a flagged check', async () => {
      submissionRepo.findOne.mockResolvedValue({ id: 'sub-1', creatorId: 'creator-1', campaignId: 'camp-1' });
      checkRepo.findOne.mockResolvedValue({
        id: 'chk-1',
        status: SafetyCheckStatus.FLAGGED,
        tierReached: 'tier2',
        requestedAt: new Date(),
        resolvedAt: new Date(),
      });
      triggerRepo.find.mockResolvedValue([
        { ruleId: 'rule-007', channel: 'audio', matchedExcerpt: 'resultado garantido em uma semana' },
      ]);
      ruleRepo.find.mockResolvedValue([{ id: 'rule-007', ruleType: 'restricted_language' }]);

      const result = await service.getCheckStatus('sub-1', { isCreator: true, creatorId: 'creator-1' });
      expect(result.triggered_rules).toHaveLength(1);
      expect(result.triggered_rules[0]).toMatchObject({ rule_id: 'rule-007', channel: 'audio' });
    });

    it('returns an honest system message for check_unavailable with no fake rule citation', async () => {
      submissionRepo.findOne.mockResolvedValue({ id: 'sub-1', creatorId: 'creator-1' });
      checkRepo.findOne.mockResolvedValue({
        id: 'chk-1',
        status: SafetyCheckStatus.CHECK_UNAVAILABLE,
        requestedAt: new Date(),
        resolvedAt: new Date(),
      });

      const result = await service.getCheckStatus('sub-1', { isCreator: true, creatorId: 'creator-1' });
      expect(result.message).toBeDefined();
      expect(result.triggered_rules).toBeUndefined();
    });

    it('allows an account member with campaign access to poll a submission', async () => {
      submissionRepo.findOne.mockResolvedValue({ id: 'sub-1', creatorId: 'creator-1', campaignId: 'camp-1' });
      campaignRepo.findOne.mockResolvedValue({ id: 'camp-1', accountId: 'account-1' });
      checkRepo.findOne.mockResolvedValue({
        id: 'chk-1',
        status: SafetyCheckStatus.PASSED,
        tierReached: 'tier1',
        requestedAt: new Date(),
        resolvedAt: new Date(),
      });

      const result = await service.getCheckStatus('sub-1', {
        isCreator: false,
        currentAccountId: 'account-1',
      });
      expect(result.status).toBe(SafetyCheckStatus.PASSED);
    });

    it('denies an account member from a different account', async () => {
      submissionRepo.findOne.mockResolvedValue({ id: 'sub-1', creatorId: 'creator-1', campaignId: 'camp-1' });
      campaignRepo.findOne.mockResolvedValue(undefined);

      await expect(
        service.getCheckStatus('sub-1', { isCreator: false, currentAccountId: 'account-other' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
