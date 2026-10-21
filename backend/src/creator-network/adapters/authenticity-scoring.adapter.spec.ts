import { describe, it, expect } from 'vitest';
import { StubAuthenticityScoringAdapter } from './authenticity-scoring.adapter';

// ADR-0052: always returns scored, deterministic per creatorId.
// insufficient_data is exercised only against a mock, not this stub.
describe('StubAuthenticityScoringAdapter - ADR-0052', () => {
  const adapter = new StubAuthenticityScoringAdapter();

  it('always returns a scored outcome with a 0-100 score', async () => {
    const result = await adapter.scoreAuthenticity({
      creatorId: 'creator-1',
      socialAccountId: 'sa-1',
      audienceSize: 5000,
      engagementRate: '2.3',
    });

    expect(result.outcome).toBe('scored');
    if (result.outcome === 'scored') {
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    }
  });

  it('is deterministic for the same creator', async () => {
    const input = { creatorId: 'creator-1', socialAccountId: 'sa-1', audienceSize: 5000, engagementRate: '2.3' };
    const first = await adapter.scoreAuthenticity(input);
    const second = await adapter.scoreAuthenticity(input);
    expect(first).toEqual(second);
  });
});
