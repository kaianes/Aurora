import { describe, it, expect } from 'vitest';
import { StubCreatorAudienceInsightsAdapter } from './creator-audience-insights.adapter';

// ADR-0051: always returns success, deterministic per (creatorId, platform).
describe('StubCreatorAudienceInsightsAdapter - ADR-0051', () => {
  const adapter = new StubCreatorAudienceInsightsAdapter();

  it('always returns outcome success with a plausible audience profile', async () => {
    const result = await adapter.getAudienceInsights({
      creatorId: 'creator-1',
      socialAccountId: 'sa-1',
      platform: 'instagram',
      accessToken: 'token',
    });

    expect(result.outcome).toBe('success');
    if (result.outcome === 'success') {
      expect(result.audienceSize).toBeGreaterThan(0);
      expect(Number(result.engagementRate)).toBeGreaterThan(0);
      expect(result.contentNiche).toBeTruthy();
    }
  });

  it('is deterministic for the same creator and platform', async () => {
    const input = { creatorId: 'creator-1', socialAccountId: 'sa-1', platform: 'instagram', accessToken: 'token' };
    const first = await adapter.getAudienceInsights(input);
    const second = await adapter.getAudienceInsights(input);
    expect(first).toEqual(second);
  });

  it('produces different figures for different creators', async () => {
    const first = await adapter.getAudienceInsights({
      creatorId: 'creator-a',
      socialAccountId: 'sa-1',
      platform: 'instagram',
      accessToken: 't',
    });
    const second = await adapter.getAudienceInsights({
      creatorId: 'creator-b',
      socialAccountId: 'sa-2',
      platform: 'instagram',
      accessToken: 't',
    });
    expect(first).not.toEqual(second);
  });
});
