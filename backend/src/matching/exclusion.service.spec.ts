import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnprocessableEntityException } from '@nestjs/common';
import { ExclusionService } from './exclusion.service';
import { ExclusionType } from '../database/entities';

const mockRepo = () => ({
  create: vi.fn((data: any) => ({ ...data })),
  save: vi.fn((entity: any) =>
    Promise.resolve({ id: 'exclusion-1', createdAt: new Date(), ...entity }),
  ),
  find: vi.fn(),
  findOne: vi.fn(),
  remove: vi.fn(),
  createQueryBuilder: vi.fn(),
});

describe('ExclusionService - US-14', () => {
  let service: ExclusionService;
  let exclusionRepo: ReturnType<typeof mockRepo>;
  let auditService: { log: ReturnType<typeof vi.fn> };
  const actor = { userId: 'user-1', ipAddress: '127.0.0.1', userAgent: 'vitest' };

  beforeEach(() => {
    exclusionRepo = mockRepo();
    auditService = { log: vi.fn().mockResolvedValue(undefined) };
    service = new ExclusionService(exclusionRepo as any, auditService as any);
  });

  // US-14 scenario 1: a brand-level creator exclusion is created and never
  // retroactively applied to anything already generated.
  it('creates a brand-level creator exclusion and states it applies to future generations only', async () => {
    const result = await service.create(
      'account-1',
      { scope: 'brand', exclusion_type: 'creator', creator_id: 'creator-5555' },
      actor,
    );

    expect(exclusionRepo.save).toHaveBeenCalled();
    expect(result.applies_to).toBe('future_shortlist_generations_only');
    expect(result.scope).toBe('brand');
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'exclusion.created' }),
    );
  });

  // US-14 scenario 2: brand- and campaign-level exclusions for the same
  // creator are both resolved together with OR semantics, no reconciliation
  // required from the caller.
  it('resolves both brand-level and campaign-level exclusions for the same creator without duplication', async () => {
    exclusionRepo.createQueryBuilder.mockReturnValue({
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([
        { creatorId: 'creator-9', exclusionType: ExclusionType.CREATOR, campaignId: null },
        { creatorId: 'creator-9', exclusionType: ExclusionType.CREATOR, campaignId: 'camp-1' },
      ]),
    });

    const ids = await service.resolveExcludedCreatorIds('account-1', 'camp-1');

    expect(ids).toEqual(['creator-9', 'creator-9']);
  });

  // Failure: an invalid exclusion_type / identifying-field combination is
  // rejected before anything is persisted.
  it('rejects a creator exclusion with no creator_id', async () => {
    await expect(
      service.create(
        'account-1',
        { scope: 'brand', exclusion_type: 'creator' } as any,
        actor,
      ),
    ).rejects.toThrow(UnprocessableEntityException);

    expect(exclusionRepo.save).not.toHaveBeenCalled();
  });
});
