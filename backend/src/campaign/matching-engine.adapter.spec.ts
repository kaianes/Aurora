import { describe, it, expect } from 'vitest';
import { StubMatchingEngineAdapter } from './matching-engine.adapter';

describe('StubMatchingEngineAdapter - US-06', () => {
  const adapter = new StubMatchingEngineAdapter();

  // US-06 scenario 1: a valid campaign gets a guaranteed minimum pool and a price.
  it('returns a guaranteed minimum pool size and total price for a normal campaign', async () => {
    const result = await adapter.estimatePool({
      accountId: 'account-1',
      audienceTargeting: { geography: ['BR-SP', 'BR-RJ'], interests: ['beleza'] },
      deliverableFormats: ['instagram_reel'],
      budgetAmount: '45000.00',
    });

    expect('noViablePool' in result).toBe(false);
    if (!('noViablePool' in result)) {
      expect(result.guaranteedMinPoolSize).toBeGreaterThan(0);
      expect(parseFloat(result.totalPrice)).toBeGreaterThan(0);
      expect(result.projectedReachHigh).toBeGreaterThan(result.projectedReachLow);
    }
  });

  // US-06 scenario 2: a tightly constrained audience still returns a small but viable pool.
  it('returns a small but non-zero pool for a narrow audience', async () => {
    const result = await adapter.estimatePool({
      accountId: 'account-1',
      audienceTargeting: { geography: ['BR-AC'], interests: ['niche-topic'] },
      deliverableFormats: ['instagram_story'],
      budgetAmount: '2000.00',
    });

    expect('noViablePool' in result).toBe(false);
    if (!('noViablePool' in result)) {
      expect(result.guaranteedMinPoolSize).toBeGreaterThanOrEqual(1);
    }
  });

  // US-06 scenario 2: zero addressable creators returns an explicit no-viable-pool result.
  it('returns noViablePool when there is no addressable audience at all', async () => {
    const result = await adapter.estimatePool({
      accountId: 'account-1',
      audienceTargeting: { geography: [], interests: [], age_range: [25, 25] },
      deliverableFormats: ['instagram_reel'],
      budgetAmount: '5000.00',
    });

    expect('noViablePool' in result).toBe(true);
  });
});
