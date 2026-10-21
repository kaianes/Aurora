import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnclaimedProfileService } from './unclaimed-profile.service';

const mockQueryRunner = {
  connect: vi.fn(),
  startTransaction: vi.fn(),
  commitTransaction: vi.fn(),
  rollbackTransaction: vi.fn(),
  release: vi.fn(),
  manager: {
    create: vi.fn((_Entity: any, data: any) => ({ id: 'generated-id', ...data })),
    save: vi.fn((entity: any) => Promise.resolve(entity)),
  },
};

describe('UnclaimedProfileService - US-23.1', () => {
  let service: UnclaimedProfileService;
  let auditService: { log: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    auditService = { log: vi.fn().mockResolvedValue(undefined) };
    const dataSource = { createQueryRunner: () => mockQueryRunner };

    Object.values(mockQueryRunner).forEach((fn) => {
      if (typeof fn === 'function') (fn as any).mockClear?.();
    });
    mockQueryRunner.manager.create.mockClear();
    mockQueryRunner.manager.save.mockClear();
    mockQueryRunner.manager.create.mockImplementation((_E: any, data: any) => ({
      id: 'generated-creator-id',
      ...data,
    }));
    mockQueryRunner.manager.save.mockImplementation((entity: any) => Promise.resolve(entity));

    service = new UnclaimedProfileService(
      {} as any,
      {} as any,
      dataSource as any,
      auditService as any,
    );
  });

  // Scenario 1: an unclaimed profile is created and quarantined.
  it('creates a creator row with status=unclaimed and a 90-day expiry, plus an immutable import snapshot', async () => {
    const result = await service.createUnclaimedProfile(
      {
        display_name: 'Duda Oliveira',
        source: 'manual_research',
        platform: 'instagram',
        observed_handle: '@duda.oliveira',
        observed_follower_count: 8400,
        observed_niche: 'beleza e skincare',
      },
      'operator-1',
      { ipAddress: '127.0.0.1', userAgent: 'test' },
    );

    expect(result.status).toBe('unclaimed');
    expect(result.creator_id).toBeDefined();
    expect(new Date(result.unclaimed_expires_at).getTime()).toBeGreaterThan(Date.now());

    expect(mockQueryRunner.manager.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'unclaimed', recruitmentOrigin: 'recruited' }),
    );
    expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'creator.unclaimed_profile_created' }),
    );
  });

  // Scenario 2: only observed data is stored, nothing is estimated.
  it('leaves unverifiable fields null when only a handful of public signals are available', async () => {
    await service.createUnclaimedProfile(
      { display_name: 'Duda Oliveira', source: 'manual_research' },
      'operator-1',
      { ipAddress: '127.0.0.1', userAgent: 'test' },
    );

    const creatorCreateCall = mockQueryRunner.manager.create.mock.calls[0];
    expect(creatorCreateCall[1].audienceSize).toBeNull();
    expect(creatorCreateCall[1].contentNiche).toBeNull();

    const importCreateCall = mockQueryRunner.manager.create.mock.calls[1];
    expect(importCreateCall[1].observedFollowerCount).toBeNull();
    expect(importCreateCall[1].observedHandle).toBeNull();
    expect(importCreateCall[1].observedNiche).toBeNull();
    expect(importCreateCall[1].rawPayload).toBeNull();
  });

  it('rolls back the transaction and rethrows on failure', async () => {
    mockQueryRunner.manager.save.mockRejectedValueOnce(new Error('db error'));

    await expect(
      service.createUnclaimedProfile(
        { display_name: 'Duda', source: 'manual_research' },
        'operator-1',
        { ipAddress: '127.0.0.1', userAgent: 'test' },
      ),
    ).rejects.toThrow('db error');

    expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
  });
});
