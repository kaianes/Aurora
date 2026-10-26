import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RunSafetyCheckProcessor } from './run-safety-check.processor';
import { SafetyCheckStatus, ReviewReasonCategory, ReviewItemStatus } from '../database/entities';

const mockRepo = () => ({
  findOne: vi.fn(),
  save: vi.fn((entity: any) => Promise.resolve(entity)),
  create: vi.fn((data: any) => ({ ...data })),
});

function job(data: any) {
  return { data } as any;
}

describe('RunSafetyCheckProcessor - US-16', () => {
  let processor: RunSafetyCheckProcessor;
  let submissionRepo: ReturnType<typeof mockRepo>;
  let campaignRepo: ReturnType<typeof mockRepo>;
  let checkRepo: ReturnType<typeof mockRepo>;
  let triggerRepo: ReturnType<typeof mockRepo>;
  let reviewRepo: ReturnType<typeof mockRepo>;
  let adapter: { evaluate: ReturnType<typeof vi.fn> };
  let rulesetService: { computeEffectiveRulesForEvaluation: ReturnType<typeof vi.fn> };
  let auditService: { log: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    submissionRepo = mockRepo();
    campaignRepo = mockRepo();
    checkRepo = mockRepo();
    triggerRepo = mockRepo();
    reviewRepo = mockRepo();
    adapter = { evaluate: vi.fn() };
    rulesetService = { computeEffectiveRulesForEvaluation: vi.fn().mockResolvedValue([]) };
    auditService = { log: vi.fn().mockResolvedValue(undefined) };

    processor = new RunSafetyCheckProcessor(
      submissionRepo as any,
      campaignRepo as any,
      checkRepo as any,
      triggerRepo as any,
      reviewRepo as any,
      adapter as any,
      rulesetService as any,
      auditService as any,
    );
  });

  it('is a no-op when the check is no longer pending (idempotent on retry/race)', async () => {
    checkRepo.findOne.mockResolvedValue({ id: 'chk-1', status: SafetyCheckStatus.CHECK_UNAVAILABLE });
    submissionRepo.findOne.mockResolvedValue({ id: 'sub-1', campaignId: 'camp-1' });

    await processor.handleRunSafetyCheck(job({ contentSubmissionId: 'sub-1', safetyCheckId: 'chk-1' }));

    expect(adapter.evaluate).not.toHaveBeenCalled();
    expect(checkRepo.save).not.toHaveBeenCalled();
  });

  it('marks the check passed when the adapter finds no violation', async () => {
    checkRepo.findOne.mockResolvedValue({ id: 'chk-1', status: SafetyCheckStatus.PENDING });
    submissionRepo.findOne.mockResolvedValue({
      id: 'sub-1',
      campaignId: 'camp-1',
      captionText: 'ola',
      onScreenText: null,
      audioTranscript: null,
    });
    campaignRepo.findOne.mockResolvedValue({ id: 'camp-1', accountId: 'account-1' });
    adapter.evaluate.mockResolvedValue({ outcome: 'pass', tierReached: 'tier1' });

    await processor.handleRunSafetyCheck(job({ contentSubmissionId: 'sub-1', safetyCheckId: 'chk-1' }));

    expect(checkRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: SafetyCheckStatus.PASSED }),
    );
    expect(reviewRepo.save).not.toHaveBeenCalled();
  });

  // US-16 scenario 2 / US-17 scenario 1: a flagged check writes one trigger
  // row per (rule, channel) hit and creates the review queue item.
  it('marks the check flagged, persists every trigger, and creates a review queue item', async () => {
    checkRepo.findOne.mockResolvedValue({ id: 'chk-1', status: SafetyCheckStatus.PENDING });
    submissionRepo.findOne.mockResolvedValue({
      id: 'sub-1',
      campaignId: 'camp-1',
      captionText: 'ola',
      onScreenText: null,
      audioTranscript: 'resultado garantido',
    });
    campaignRepo.findOne.mockResolvedValue({ id: 'camp-1', accountId: 'account-1' });
    adapter.evaluate.mockResolvedValue({
      outcome: 'flagged',
      tierReached: 'tier1',
      triggers: [{ ruleId: 'rule-007', channel: 'audio', matchedExcerpt: 'resultado garantido' }],
    });

    await processor.handleRunSafetyCheck(job({ contentSubmissionId: 'sub-1', safetyCheckId: 'chk-1' }));

    expect(checkRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: SafetyCheckStatus.FLAGGED }),
    );
    expect(triggerRepo.save).toHaveBeenCalledWith([
      expect.objectContaining({ ruleId: 'rule-007', channel: 'audio' }),
    ]);
    expect(reviewRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        reasonCategory: ReviewReasonCategory.RULE_VIOLATION,
        status: ReviewItemStatus.PENDING,
      }),
    );
  });

  // ADR-0022: an adapter failure is treated like "the engine is down" --
  // the check is left pending for the sweeper, not force-resolved here.
  it('leaves the check pending (for the sweeper) when the adapter throws', async () => {
    checkRepo.findOne.mockResolvedValue({ id: 'chk-1', status: SafetyCheckStatus.PENDING });
    submissionRepo.findOne.mockResolvedValue({
      id: 'sub-1',
      campaignId: 'camp-1',
      captionText: 'ola',
      onScreenText: null,
      audioTranscript: null,
    });
    campaignRepo.findOne.mockResolvedValue({ id: 'camp-1', accountId: 'account-1' });
    adapter.evaluate.mockRejectedValue(new Error('engine down'));

    await processor.handleRunSafetyCheck(job({ contentSubmissionId: 'sub-1', safetyCheckId: 'chk-1' }));

    expect(checkRepo.save).not.toHaveBeenCalled();
  });
});
