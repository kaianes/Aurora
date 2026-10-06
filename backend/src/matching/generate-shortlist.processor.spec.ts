import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GenerateShortlistProcessor } from './generate-shortlist.processor';
import { ShortlistStatus, AdditionalCandidatesRequestStatus } from '../database/entities';

const mockRepo = () => ({
  findOne: vi.fn(),
  find: vi.fn().mockResolvedValue([]),
  create: vi.fn((data: any) => ({ ...data })),
  save: vi.fn((entity: any) => Promise.resolve(entity)),
});

describe('GenerateShortlistProcessor - US-11', () => {
  let processor: GenerateShortlistProcessor;
  let campaignRepo: ReturnType<typeof mockRepo>;
  let shortlistRepo: ReturnType<typeof mockRepo>;
  let entryRepo: ReturnType<typeof mockRepo>;
  let requestRepo: ReturnType<typeof mockRepo>;
  let matchingEngine: { generateShortlist: ReturnType<typeof vi.fn> };
  let exclusionService: { resolveExcludedCreatorIds: ReturnType<typeof vi.fn> };
  let auditService: { log: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    campaignRepo = mockRepo();
    shortlistRepo = mockRepo();
    entryRepo = mockRepo();
    requestRepo = mockRepo();
    matchingEngine = { generateShortlist: vi.fn() };
    exclusionService = { resolveExcludedCreatorIds: vi.fn().mockResolvedValue([]) };
    auditService = { log: vi.fn().mockResolvedValue(undefined) };

    processor = new GenerateShortlistProcessor(
      campaignRepo as any,
      shortlistRepo as any,
      entryRepo as any,
      requestRepo as any,
      matchingEngine as any,
      exclusionService as any,
      auditService as any,
    );
  });

  function runJob(data: any = { campaignId: 'camp-1', shortlistId: 'sl-1' }) {
    return processor.handleGenerateShortlist({ data } as any);
  }

  // ---- Normal: a ready shortlist is written with ranked entries ----
  it('writes ranked entries and marks the shortlist ready', async () => {
    campaignRepo.findOne.mockResolvedValue({ id: 'camp-1', accountId: 'account-1', guaranteedMinPoolSize: 1 });
    shortlistRepo.findOne.mockResolvedValue({ id: 'sl-1', campaignId: 'camp-1' });
    matchingEngine.generateShortlist.mockResolvedValue({
      status: 'ready',
      entries: [{ creatorId: 'creator-1', rank: 1, fitScore: 0.9, matchedAttributes: ['interests:beleza'] }],
    });

    await runJob();

    expect(entryRepo.save).toHaveBeenCalled();
    expect(shortlistRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: ShortlistStatus.READY, belowGuaranteedMinimum: false }),
    );
  });

  // ---- Hard: fewer eligible creators than the guaranteed minimum sets the warning flag ----
  it('flags below_guaranteed_minimum when fewer entries than the guarantee come back', async () => {
    campaignRepo.findOne.mockResolvedValue({ id: 'camp-1', accountId: 'account-1', guaranteedMinPoolSize: 5 });
    shortlistRepo.findOne.mockResolvedValue({ id: 'sl-1', campaignId: 'camp-1' });
    matchingEngine.generateShortlist.mockResolvedValue({
      status: 'ready',
      entries: [{ creatorId: 'creator-1', rank: 1, fitScore: 0.9, matchedAttributes: [] }],
    });

    await runJob();

    expect(shortlistRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: ShortlistStatus.READY, belowGuaranteedMinimum: true }),
    );
  });

  // ---- Failure: the matching engine times out or errors ----
  it('marks the shortlist failed with an explicit, retryable reason when the engine errors', async () => {
    campaignRepo.findOne.mockResolvedValue({ id: 'camp-1', accountId: 'account-1', guaranteedMinPoolSize: 1 });
    shortlistRepo.findOne.mockResolvedValue({ id: 'sl-1', campaignId: 'camp-1' });
    matchingEngine.generateShortlist.mockRejectedValue(new Error('engine down'));

    await runJob();

    expect(shortlistRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: ShortlistStatus.FAILED, failureReason: expect.any(String) }),
    );
    expect(auditService.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'shortlist.failed' }));
  });

  // ---- Failure: zero eligible creators is reported explicitly, not padded ----
  it('marks the shortlist no_viable_pool when the engine finds no eligible creators', async () => {
    campaignRepo.findOne.mockResolvedValue({ id: 'camp-1', accountId: 'account-1', guaranteedMinPoolSize: 1 });
    shortlistRepo.findOne.mockResolvedValue({ id: 'sl-1', campaignId: 'camp-1' });
    matchingEngine.generateShortlist.mockResolvedValue({ status: 'no_viable_pool' });

    await runJob();

    expect(shortlistRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: ShortlistStatus.NO_VIABLE_POOL }),
    );
  });

  // ---- ADR-0018: a top-up excludes everyone already on the shortlist and never re-prices ----
  it('appends top-up entries without creating a new quote', async () => {
    campaignRepo.findOne.mockResolvedValue({ id: 'camp-1', accountId: 'account-1' });
    shortlistRepo.findOne.mockResolvedValue({ id: 'sl-1', campaignId: 'camp-1' });
    requestRepo.findOne.mockResolvedValue({ id: 'req-1', requestedCount: 3 });
    entryRepo.find.mockResolvedValue([{ creatorId: 'creator-1', rank: 1 }]);
    matchingEngine.generateShortlist.mockResolvedValue({
      status: 'ready',
      entries: [{ creatorId: 'creator-2', rank: 1, fitScore: 0.8, matchedAttributes: [] }],
    });

    await processor.handleTopUpShortlist({
      data: { campaignId: 'camp-1', shortlistId: 'sl-1', requestId: 'req-1' },
    } as any);

    expect(matchingEngine.generateShortlist).toHaveBeenCalledWith(
      expect.objectContaining({ alreadyOnShortlistCreatorIds: ['creator-1'] }),
    );
    expect(requestRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: AdditionalCandidatesRequestStatus.FULFILLED }),
    );
  });

  // ---- ADR-0018 failure path: engine cannot fill the gap even with the broader pool ----
  it('marks the request no_additional_candidates when the engine cannot fill the shortfall', async () => {
    campaignRepo.findOne.mockResolvedValue({ id: 'camp-1', accountId: 'account-1' });
    shortlistRepo.findOne.mockResolvedValue({ id: 'sl-1', campaignId: 'camp-1' });
    requestRepo.findOne.mockResolvedValue({ id: 'req-1', requestedCount: 3 });
    matchingEngine.generateShortlist.mockResolvedValue({ status: 'no_viable_pool' });

    await processor.handleTopUpShortlist({
      data: { campaignId: 'camp-1', shortlistId: 'sl-1', requestId: 'req-1' },
    } as any);

    expect(requestRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: AdditionalCandidatesRequestStatus.NO_ADDITIONAL_CANDIDATES }),
    );
  });
});
