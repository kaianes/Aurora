import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReviewDecisionService } from './review-decision.service';
import { DraftSubmissionService } from './draft-submission.service';
import { ContentReviewDecisionValue } from '../database/entities';

const actorBrand = { userId: 'user-marina', ipAddress: '127.0.0.1', userAgent: 'vitest' };
const actorCreator = { ipAddress: '127.0.0.1', userAgent: 'vitest' };

// A minimal in-memory double of a TypeORM repository, shared by reference between
// ReviewDecisionService (the write side, US-19) and DraftSubmissionService (Duda's read side,
// US-33) in this spec -- the whole point being that both services read and write the exact same
// row object, with no separate, divergent copy kept anywhere for Duda's view.
function inMemoryRepo<T extends { id?: string }>() {
  const rows: T[] = [];
  let counter = 0;
  return {
    rows,
    findOne: vi.fn(async ({ where }: any) => {
      return rows.find((row: any) =>
        Object.entries(where).every(([key, value]) => row[key] === value),
      );
    }),
    find: vi.fn(async ({ where, order }: any) => {
      let matches = rows.filter((row: any) =>
        Object.entries(where || {}).every(([key, value]) => row[key] === value),
      );
      if (order?.versionNumber === 'ASC') matches = matches.sort((a: any, b: any) => a.versionNumber - b.versionNumber);
      if (order?.versionNumber === 'DESC') matches = matches.sort((a: any, b: any) => b.versionNumber - a.versionNumber);
      return matches;
    }),
    create: vi.fn((data: any) => ({ ...data })),
    save: vi.fn(async (entity: any) => {
      const id = entity.id || `row-${++counter}`;
      const saved = { ...entity, id };
      const existingIndex = rows.findIndex((r: any) => r.id === id);
      if (existingIndex >= 0) rows[existingIndex] = saved as any;
      else rows.push(saved as any);
      return saved;
    }),
  };
}

describe('US-19/US-33: the decision record Marina writes is the exact one Duda reads', () => {
  let submissionRepo: ReturnType<typeof inMemoryRepo<any>>;
  let decisionRepo: ReturnType<typeof inMemoryRepo<any>>;
  let campaignRepo: ReturnType<typeof inMemoryRepo<any>>;
  let opportunityRepo: ReturnType<typeof inMemoryRepo<any>>;
  let creatorRepo: ReturnType<typeof inMemoryRepo<any>>;
  let auditService: { log: ReturnType<typeof vi.fn> };
  let reviewDecisionService: ReviewDecisionService;
  let draftSubmissionService: DraftSubmissionService;

  const submission = {
    id: 'sub-6001',
    campaignId: 'camp-1',
    creatorId: 'creator-1',
    opportunityId: 'opp-1',
    versionNumber: 1,
    supersedesSubmissionId: null,
    rootSubmissionId: 'sub-6001',
    reviewDeadlineAt: new Date('2026-10-23T09:00:00Z'),
    reviewEscalated: false,
    publishedUrl: null,
    submittedAt: new Date('2026-10-21T09:00:00Z'),
  };

  beforeEach(() => {
    submissionRepo = inMemoryRepo();
    decisionRepo = inMemoryRepo();
    campaignRepo = inMemoryRepo();
    opportunityRepo = inMemoryRepo();
    creatorRepo = inMemoryRepo();
    auditService = { log: vi.fn().mockResolvedValue(undefined) };

    submissionRepo.rows.push({ ...submission });
    campaignRepo.rows.push({ id: 'camp-1', accountId: 'account-1' });
    opportunityRepo.rows.push({ id: 'opp-1', creatorId: 'creator-1' });

    reviewDecisionService = new ReviewDecisionService(
      submissionRepo as any,
      decisionRepo as any,
      campaignRepo as any,
      auditService as any,
    );

    const gateService = { getGateStatus: vi.fn().mockResolvedValue({ cleared: true, blockingReason: null }) };
    draftSubmissionService = new DraftSubmissionService(
      campaignRepo as any,
      opportunityRepo as any,
      submissionRepo as any,
      decisionRepo as any,
      creatorRepo as any,
      {} as any,
      gateService as any,
    );
  });

  it('shows Duda the same reason, decision, and decided_at Marina just recorded, with no transformation', async () => {
    const written = await reviewDecisionService.decide(
      'sub-6001',
      'account-1',
      { decision: 'rejected', reason: 'O produto nao aparece em nenhum momento do video.' },
      actorBrand,
    );

    expect(decisionRepo.rows).toHaveLength(1);

    const dudaView = await draftSubmissionService.listForCreator('creator-1', 'opp-1');
    expect(dudaView.data).toHaveLength(1);
    const dudaVersion = dudaView.data[0];

    // Same decision value, same reason text, same decided_at timestamp -- read straight off the
    // one row ReviewDecisionService wrote, not a second, independently-maintained copy.
    expect(dudaVersion.review_status).toBe(ContentReviewDecisionValue.REJECTED);
    expect(dudaVersion.review_reason).toBe('O produto nao aparece em nenhum momento do video.');
    expect(dudaVersion.review_decided_at).toBe(written.decided_at);
    expect(decisionRepo.rows[0].id).toBe(written.id);
  });

  it('never lets Duda see a decision as final without its reason already attached (US-33 scenario 3)', async () => {
    await expect(
      reviewDecisionService.decide('sub-6001', 'account-1', { decision: 'rejected' }, actorBrand),
    ).rejects.toMatchObject({ response: { error: { code: 'REASON_REQUIRED' } } });

    // Nothing was written at all -- Duda's view still shows pending, never a reasonless rejection.
    const dudaView = await draftSubmissionService.listForCreator('creator-1', 'opp-1');
    expect(dudaView.data[0].review_status).toBe('pending');
    expect(dudaView.data[0].review_reason).toBeNull();
  });
});
