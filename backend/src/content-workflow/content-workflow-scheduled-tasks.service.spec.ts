import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContentWorkflowScheduledTasksService } from './content-workflow-scheduled-tasks.service';

const mockRepo = () => ({
  find: vi.fn().mockResolvedValue([]),
  findOne: vi.fn(),
  save: vi.fn((entity: any) => Promise.resolve({ ...entity })),
});

describe('ContentWorkflowScheduledTasksService - US-32b', () => {
  let service: ContentWorkflowScheduledTasksService;
  let submissionRepo: ReturnType<typeof mockRepo>;
  let decisionRepo: ReturnType<typeof mockRepo>;
  let auditService: { log: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    submissionRepo = mockRepo();
    decisionRepo = mockRepo();
    auditService = { log: vi.fn().mockResolvedValue(undefined) };
    service = new ContentWorkflowScheduledTasksService(submissionRepo as any, decisionRepo as any, auditService as any);
  });

  it('escalates an overdue submission with no decision yet (US-32b scenario 2)', async () => {
    submissionRepo.find.mockResolvedValue([{ id: 'sub-1', campaignId: 'camp-1', reviewEscalated: false }]);
    decisionRepo.findOne.mockResolvedValue(undefined);

    await service.escalateOverdueDraftReviews();

    expect(submissionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ reviewEscalated: true, id: 'sub-1' }),
    );
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'content_submission.review_escalated' }),
    );
  });

  it('never escalates a submission that already has a decision recorded', async () => {
    submissionRepo.find.mockResolvedValue([{ id: 'sub-1', campaignId: 'camp-1', reviewEscalated: false }]);
    decisionRepo.findOne.mockResolvedValue({ decision: 'approved' });

    await service.escalateOverdueDraftReviews();

    expect(submissionRepo.save).not.toHaveBeenCalled();
  });

  it('is a no-op when there are no overdue candidates', async () => {
    submissionRepo.find.mockResolvedValue([]);
    await service.escalateOverdueDraftReviews();
    expect(decisionRepo.findOne).not.toHaveBeenCalled();
  });

  // US-32b scenario 3 / ADR-0030: escalation is a visibility-only flag, never an auto-action --
  // the sweeper must never itself create, approve, reject, or otherwise decide anything. Its only
  // writes are the two escalation fields on content_submission plus the audit log entry.
  it('never creates or otherwise touches a content_review_decision row -- escalation is a flag, not a decision', async () => {
    submissionRepo.find.mockResolvedValue([{ id: 'sub-1', campaignId: 'camp-1', reviewEscalated: false }]);
    decisionRepo.findOne.mockResolvedValue(undefined);

    await service.escalateOverdueDraftReviews();

    expect(decisionRepo.findOne).toHaveBeenCalledWith({ where: { contentSubmissionId: 'sub-1' } });
    // The service only ever reads decisionRepo (to check whether a decision already exists) --
    // it never writes to it. This is this test's structural proof that no decision is ever
    // created by the sweeper itself.
    expect(decisionRepo.save).not.toHaveBeenCalled();
    expect(submissionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ reviewEscalated: true, reviewEscalatedAt: expect.any(Date) }),
    );
  });
});
