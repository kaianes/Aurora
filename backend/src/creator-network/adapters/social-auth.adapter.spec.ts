import { describe, it, expect } from 'vitest';
import { StubSocialAuthAdapter } from './social-auth.adapter';

// ADR-0050: this pilot's only implementation always succeeds, deterministically.
describe('StubSocialAuthAdapter - ADR-0050', () => {
  const adapter = new StubSocialAuthAdapter();

  it('builds a simulated-consent URL, never a real platform OAuth screen', () => {
    const url = adapter.getAuthorizationUrl({
      platform: 'instagram',
      state: 'st-001',
      redirectUri: 'https://backend.aurora.com.br/callback',
    });

    expect(url).toContain('aurora.com.br/_simulated-oauth/instagram');
    expect(url).toContain('state=st-001');
  });

  it('exchangeCode always grants deterministic synthetic tokens', async () => {
    const result = await adapter.exchangeCode({
      platform: 'instagram',
      code: 'some-code',
      redirectUri: 'https://backend/callback',
    });

    expect(result.outcome).toBe('granted');
    if (result.outcome === 'granted') {
      expect(result.accessToken).toBeTruthy();
      expect(result.platformHandle).toBeTruthy();
    }
  });

  it('is deterministic: the same platform and code produce the same tokens', async () => {
    const input = { platform: 'instagram', code: 'fixed-code', redirectUri: 'https://backend/callback' };
    const first = await adapter.exchangeCode(input);
    const second = await adapter.exchangeCode(input);
    expect(first).toEqual(second);
  });

  it('refreshToken always reports refreshed in normal operation', async () => {
    const result = await adapter.refreshToken({ platform: 'instagram', refreshToken: 'some-refresh-token' });
    expect(result.outcome).toBe('refreshed');
  });
});
