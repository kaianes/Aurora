import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RealMatchingEngineAdapter } from './real-matching-engine.adapter';
import { CreatorStatus, CreatorOnboardingStatus } from '../database/entities';

function makeCreator(overrides: Partial<any> = {}) {
  return {
    id: overrides.id || 'creator-1',
    status: CreatorStatus.ACTIVE,
    onboardingStatus: CreatorOnboardingStatus.QUALIFIED,
    contentNiche: 'beleza e skincare',
    engagementRate: '4.0',
    authenticityScore: '80',
    historicalReliability: null,
    ...overrides,
  };
}

describe('RealMatchingEngineAdapter - US-11', () => {
  let adapter: RealMatchingEngineAdapter;
  let creatorRepo: any;

  beforeEach(() => {
    creatorRepo = {
      createQueryBuilder: vi.fn(),
    };
    adapter = new RealMatchingEngineAdapter(creatorRepo);
  });

  function mockCandidates(rows: any[]) {
    let excluded: string[] = [];
    const qb: any = {
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn((clause: string, params: any) => {
        if (clause.includes('NOT IN') && params?.excludedIds) {
          excluded = params.excludedIds;
        }
        return qb;
      }),
      limit: vi.fn().mockReturnThis(),
      getMany: vi.fn(() =>
        Promise.resolve(rows.filter((r) => !excluded.includes(r.id))),
      ),
    };
    creatorRepo.createQueryBuilder.mockReturnValue(qb);
  }

  // US-11 scenario 1: a normal campaign gets a ranked shortlist with matched
  // attributes attached, scored by the weighted multi-signal model (ADR-0011).
  it('ranks eligible creators and attaches matched attributes', async () => {
    mockCandidates([
      makeCreator({ id: 'creator-1', authenticityScore: '90', engagementRate: '5.0' }),
      makeCreator({ id: 'creator-2', authenticityScore: '40', engagementRate: '1.0' }),
    ]);

    const result = await adapter.generateShortlist({
      campaignId: 'camp-1',
      accountId: 'account-1',
      audienceTargeting: { interests: ['beleza'] },
      deliverableFormats: ['instagram_reel'],
      guaranteedMinPoolSize: 2,
      excludedCreatorIds: [],
      alreadyOnShortlistCreatorIds: [],
      maxCandidates: 150,
    });

    expect(result.status).toBe('ready');
    if (result.status === 'ready') {
      expect(result.entries).toHaveLength(2);
      expect(result.entries[0].creatorId).toBe('creator-1'); // higher authenticity+engagement ranks first
      expect(result.entries[0].rank).toBe(1);
      expect(result.entries[0].matchedAttributes).toContain('interests:beleza');
    }
  });

  // US-11 scenario 2: a narrow niche with fewer eligible creators than the
  // guaranteed minimum still returns every eligible creator, ranked, rather
  // than padding or failing silently.
  it('returns every eligible creator ranked even when below the guaranteed minimum', async () => {
    mockCandidates([makeCreator({ id: 'creator-1' })]);

    const result = await adapter.generateShortlist({
      campaignId: 'camp-1',
      accountId: 'account-1',
      audienceTargeting: { interests: ['beleza'] },
      deliverableFormats: ['instagram_reel'],
      guaranteedMinPoolSize: 10,
      excludedCreatorIds: [],
      alreadyOnShortlistCreatorIds: [],
      maxCandidates: 150,
    });

    expect(result.status).toBe('ready');
    if (result.status === 'ready') {
      expect(result.entries).toHaveLength(1);
    }
  });

  // US-11 scenario 3 / US-14: zero eligible creators (e.g. everyone excluded,
  // or zero audience-attribute overlap) is reported explicitly as
  // no_viable_pool, never a blank or crashed result.
  it('returns no_viable_pool when every candidate is excluded', async () => {
    mockCandidates([makeCreator({ id: 'creator-1' })]);

    const result = await adapter.generateShortlist({
      campaignId: 'camp-1',
      accountId: 'account-1',
      audienceTargeting: { interests: ['beleza'] },
      deliverableFormats: ['instagram_reel'],
      guaranteedMinPoolSize: 5,
      excludedCreatorIds: ['creator-1'],
      alreadyOnShortlistCreatorIds: [],
      maxCandidates: 150,
    });

    expect(result.status).toBe('no_viable_pool');
  });

  // Advisor feedback, Sprint 5: geography/age_range/gender were previously
  // marked matched unconditionally, with no real creator data behind the
  // check. A campaign targeting only these dimensions must still produce a
  // viable, ranked pool (not no_viable_pool, and not every creator scored
  // 0 either) -- and must not claim a geography/age/gender check happened
  // in matched_attributes when none did.
  it('does not claim geography, age_range, or gender were checked, and still produces a viable pool on them alone', async () => {
    mockCandidates([makeCreator({ id: 'creator-1' }), makeCreator({ id: 'creator-2' })]);

    const result = await adapter.generateShortlist({
      campaignId: 'camp-1',
      accountId: 'account-1',
      audienceTargeting: { geography: ['BR-SP'], age_range: [18, 34], gender: 'female' },
      deliverableFormats: ['instagram_reel'],
      guaranteedMinPoolSize: 2,
      excludedCreatorIds: [],
      alreadyOnShortlistCreatorIds: [],
      maxCandidates: 150,
    });

    expect(result.status).toBe('ready');
    if (result.status === 'ready') {
      expect(result.entries).toHaveLength(2);
      for (const entry of result.entries) {
        expect(entry.matchedAttributes).not.toEqual(
          expect.arrayContaining([
            expect.stringMatching(/^geography:/),
            expect.stringMatching(/^age_range:/),
            expect.stringMatching(/^gender:/),
          ]),
        );
      }
    }
  });

  // interests must still be the real, measured dimension it always was --
  // this isn't a regression of the one targeting dimension Aurora can
  // actually check (content_niche substring match).
  it('still scores interests for real alongside the now-excluded geography/age_range/gender', async () => {
    mockCandidates([
      makeCreator({ id: 'matches-niche', contentNiche: 'beleza e skincare' }),
      makeCreator({ id: 'off-niche', contentNiche: 'games' }),
    ]);

    const result = await adapter.generateShortlist({
      campaignId: 'camp-1',
      accountId: 'account-1',
      audienceTargeting: { geography: ['BR-SP'], interests: ['beleza'] },
      deliverableFormats: ['instagram_reel'],
      guaranteedMinPoolSize: 1,
      excludedCreatorIds: [],
      alreadyOnShortlistCreatorIds: [],
      maxCandidates: 150,
    });

    expect(result.status).toBe('ready');
    if (result.status === 'ready') {
      expect(result.entries.map((e) => e.creatorId)).toEqual(['matches-niche']);
      expect(result.entries[0].matchedAttributes).toEqual(['interests:beleza']);
    }
  });

  it('never uses the authenticity score as an eligibility filter (ADR-0017)', async () => {
    mockCandidates([makeCreator({ id: 'creator-low-auth', authenticityScore: '5' })]);

    const result = await adapter.generateShortlist({
      campaignId: 'camp-1',
      accountId: 'account-1',
      audienceTargeting: {},
      deliverableFormats: [],
      guaranteedMinPoolSize: 1,
      excludedCreatorIds: [],
      alreadyOnShortlistCreatorIds: [],
      maxCandidates: 150,
    });

    expect(result.status).toBe('ready');
    if (result.status === 'ready') {
      expect(result.entries.map((e) => e.creatorId)).toContain('creator-low-auth');
    }
  });
});
