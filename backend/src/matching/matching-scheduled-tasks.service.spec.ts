import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MatchingScheduledTasksService } from './matching-scheduled-tasks.service';
import { OpportunityStatus } from '../database/entities';

const mockRepo = () => ({
  find: vi.fn().mockResolvedValue([]),
  findOne: vi.fn(),
  save: vi.fn((entity: any) => Promise.resolve({ ...entity })),
  update: vi.fn().mockResolvedValue({ affected: 1 }),
});

describe('MatchingScheduledTasksService - US-28 scenario 3 / ADR-0012', () => {
  let service: MatchingScheduledTasksService;
  let opportunityRepo: ReturnType<typeof mockRepo>;
  let creatorRepo: ReturnType<typeof mockRepo>;
  let entryRepo: ReturnType<typeof mockRepo>;
  let poolMemberRepo: ReturnType<typeof mockRepo>;
  let auditService: { log: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    opportunityRepo = mockRepo();
    creatorRepo = mockRepo();
    entryRepo = mockRepo();
    poolMemberRepo = mockRepo();
    auditService = { log: vi.fn().mockResolvedValue(undefined) };

    service = new MatchingScheduledTasksService(
      opportunityRepo as any,
      creatorRepo as any,
      entryRepo as any,
      poolMemberRepo as any,
      auditService as any,
    );
  });

  it('excludes the creator from the pool when their opportunity expires unanswered', async () => {
    opportunityRepo.find.mockResolvedValue([
      {
        id: 'opp-1',
        campaignId: 'camp-1',
        creatorId: 'creator-1',
        shortlistEntryId: 'entry-1',
        status: OpportunityStatus.PENDING,
      },
    ]);
    entryRepo.findOne.mockResolvedValue({ id: 'entry-1', included: true });

    await service.expireOpportunities();

    expect(entryRepo.update).toHaveBeenCalledWith({ id: 'entry-1' }, { included: false });
    expect(poolMemberRepo.update).toHaveBeenCalledWith(
      { campaignId: 'camp-1', creatorId: 'creator-1' },
      { status: 'excluded' },
    );
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'opportunity.expired' }),
    );
  });

  it('does nothing when there are no pending-expired opportunities', async () => {
    opportunityRepo.find.mockResolvedValue([]);

    await service.expireOpportunities();

    expect(entryRepo.update).not.toHaveBeenCalled();
    expect(poolMemberRepo.update).not.toHaveBeenCalled();
  });
});
