import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BrandSafetyScheduledTasksService } from './brand-safety-scheduled-tasks.service';
import {
  SafetyCheck,
  SafetyRuleTrigger,
  SafetyReviewQueueItem,
  PublishedContentSnapshot,
  SafetyCheckStatus,
  SafetyTriggerChannel,
  ReviewReasonCategory,
  ReviewItemStatus,
  MonitoringStatus,
  MonitoringResult,
} from '../database/entities';

const mockRepo = () => ({
  find: vi.fn().mockResolvedValue([]),
  save: vi.fn((entity: any) => Promise.resolve(entity)),
  create: vi.fn((data: any) => ({ ...data })),
});

describe('BrandSafetyScheduledTasksService', () => {
  let service: BrandSafetyScheduledTasksService;
  let checkRepo: ReturnType<typeof mockRepo>;
  let triggerRepo: ReturnType<typeof mockRepo>;
  let reviewRepo: ReturnType<typeof mockRepo>;
  let snapshotRepo: ReturnType<typeof mockRepo>;
  let liveContentFetcher: { fetchLiveCaption: ReturnType<typeof vi.fn> };
  let auditService: { log: ReturnType<typeof vi.fn> };
  let dataSource: { transaction: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    checkRepo = mockRepo();
    triggerRepo = mockRepo();
    reviewRepo = mockRepo();
    snapshotRepo = mockRepo();
    liveContentFetcher = { fetchLiveCaption: vi.fn() };
    auditService = { log: vi.fn().mockResolvedValue(undefined) };

    // Both cron methods now pin app.aurora_system_job inside their own
    // dataSource.transaction() (2026-11-02, the same no-account-context gap
    // register/login had) rather than querying the injected repos
    // directly -- the mock manager's getRepository() routes to these same
    // mock repos so every existing assertion below still holds.
    const manager = {
      query: vi.fn().mockResolvedValue(undefined),
      getRepository: vi.fn((entity: any) => {
        if (entity === SafetyCheck) return checkRepo;
        if (entity === SafetyRuleTrigger) return triggerRepo;
        if (entity === SafetyReviewQueueItem) return reviewRepo;
        if (entity === PublishedContentSnapshot) return snapshotRepo;
        throw new Error(`unexpected entity in test: ${entity}`);
      }),
    };
    dataSource = {
      transaction: vi.fn((work: (manager: any) => Promise<any>) => work(manager)),
    };

    service = new BrandSafetyScheduledTasksService(
      liveContentFetcher as any,
      auditService as any,
      dataSource as any,
    );
  });

  // ADR-0022: a stuck pending check past timeout_at transitions to
  // check_unavailable, with exactly one system trigger row and a review
  // queue item honestly categorized as check_unavailable, not a rule violation.
  it('expires a stale pending check to check_unavailable with an honest system trigger and review item', async () => {
    checkRepo.find.mockResolvedValue([
      { id: 'chk-1', campaignId: 'camp-1', contentSubmissionId: 'sub-1', status: SafetyCheckStatus.PENDING },
    ]);

    await service.expirePendingChecks();

    expect(checkRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: SafetyCheckStatus.CHECK_UNAVAILABLE }),
    );
    expect(triggerRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ channel: SafetyTriggerChannel.SYSTEM, ruleId: null }),
    );
    expect(reviewRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        reasonCategory: ReviewReasonCategory.CHECK_UNAVAILABLE,
        status: ReviewItemStatus.PENDING,
      }),
    );
  });

  it('does nothing when there are no stale pending checks', async () => {
    checkRepo.find.mockResolvedValue([]);
    await service.expirePendingChecks();
    expect(checkRepo.save).not.toHaveBeenCalled();
  });

  // US-16b scenario 3: a removed/unreachable post is never reported as matching.
  it('marks an unreachable published post distinctly, never as matching', async () => {
    snapshotRepo.find.mockResolvedValue([
      {
        id: 'snap-1',
        publishedUrl: 'https://instagram.com/p/abc',
        approvedCaptionText: 'texto aprovado',
        monitoringStatus: MonitoringStatus.ACTIVE,
        consecutiveUnreachableCount: 1,
      },
    ]);
    liveContentFetcher.fetchLiveCaption.mockResolvedValue({ reachable: false });

    await service.monitorPublishedContent();

    expect(snapshotRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        lastResult: MonitoringResult.UNREACHABLE,
        consecutiveUnreachableCount: 2,
        deviationDetails: { reason: 'link_unreachable_or_removed' },
      }),
    );
  });

  // US-16b scenario 2: states what changed, not just "a difference exists."
  it('flags a deviated caption with the specific field and both values', async () => {
    snapshotRepo.find.mockResolvedValue([
      {
        id: 'snap-1',
        publishedUrl: 'https://instagram.com/p/abc',
        approvedCaptionText: 'Esse serum mudou minha pele em 14 dias!',
        monitoringStatus: MonitoringStatus.ACTIVE,
        consecutiveUnreachableCount: 0,
      },
    ]);
    liveContentFetcher.fetchLiveCaption.mockResolvedValue({
      reachable: true,
      captionText: 'Esse serum mudou minha pele em 14 dias! Link na bio com desconto de 70%',
    });

    await service.monitorPublishedContent();

    expect(snapshotRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        lastResult: MonitoringResult.DEVIATED,
        deviationDetails: expect.objectContaining({ field: 'caption_text' }),
      }),
    );
  });

  // US-16b scenario 1: a published post that still matches requires no action.
  it('marks a matching published post with no deviation details', async () => {
    snapshotRepo.find.mockResolvedValue([
      {
        id: 'snap-1',
        publishedUrl: 'https://instagram.com/p/abc',
        approvedCaptionText: 'texto aprovado',
        monitoringStatus: MonitoringStatus.ACTIVE,
        consecutiveUnreachableCount: 0,
      },
    ]);
    liveContentFetcher.fetchLiveCaption.mockResolvedValue({ reachable: true, captionText: 'texto aprovado' });

    await service.monitorPublishedContent();

    expect(snapshotRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ lastResult: MonitoringResult.MATCHING, deviationDetails: null }),
    );
  });
});
