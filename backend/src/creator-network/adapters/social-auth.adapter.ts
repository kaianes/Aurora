import { Injectable } from '@nestjs/common';

export type SocialAuthPlatform = 'instagram' | 'tiktok' | 'youtube';

export type ExchangeCodeOutcome =
  | {
      outcome: 'granted';
      accessToken: string;
      refreshToken: string | null;
      expiresAt: Date;
      scope: string[];
      platformUserId: string;
      platformHandle: string;
    }
  | { outcome: 'denied' }
  | { outcome: 'unavailable' };

export type RefreshTokenOutcome =
  | { outcome: 'refreshed'; accessToken: string; refreshToken: string; expiresAt: Date }
  | { outcome: 'revoked' }
  | { outcome: 'unavailable' };

// ADR-0051 (section 3.1 of the E8 architecture doc): OAuth mechanics only --
// authorization URL generation, code exchange, token refresh. Deliberately
// separate from CreatorAudienceInsightsAdapter (ADR-0051) and from E7's
// SocialMetricsAdapter, neither of which this epic touches.
export interface SocialAuthAdapter {
  getAuthorizationUrl(input: {
    platform: SocialAuthPlatform;
    state: string;
    redirectUri: string;
  }): string;

  exchangeCode(input: {
    platform: string;
    code: string;
    redirectUri: string;
  }): Promise<ExchangeCodeOutcome>;

  refreshToken(input: { platform: string; refreshToken: string }): Promise<RefreshTokenOutcome>;
}

export const SOCIAL_AUTH_ADAPTER = 'SOCIAL_AUTH_ADAPTER';

// ADR-0050: this pilot's only implementation. Makes no network call to
// Meta, TikTok, or Google -- no developer app is registered with any
// platform for this pilot. getAuthorizationUrl points at Aurora's own
// internal, clearly-labeled simulated-consent page, never a real platform
// OAuth screen. exchangeCode and refreshToken always succeed
// deterministically in normal operation; their denied/revoked/unavailable
// branches are exercised only in integration tests against a mock
// implementing this same interface, exactly as every other stub in this
// codebase (StubPayoutExecutionAdapter, StubSocialMetricsAdapter) is tested
// without the stub itself behaving unpredictably. The controller layer
// (GET .../callback) is what actually produces the denied/unavailable
// outcomes an end-to-end tester sees, from the error/code query parameters
// the simulated consent page redirects back with -- this stub's own
// exchangeCode is never asked to guess that from an opaque code value.
@Injectable()
export class StubSocialAuthAdapter implements SocialAuthAdapter {
  getAuthorizationUrl(input: {
    platform: SocialAuthPlatform;
    state: string;
    redirectUri: string;
  }): string {
    const params = new URLSearchParams({
      state: input.state,
      redirect_uri: input.redirectUri,
    });
    return `https://aurora.com.br/_simulated-oauth/${input.platform}?${params.toString()}`;
  }

  async exchangeCode(input: {
    platform: string;
    code: string;
    redirectUri: string;
  }): Promise<ExchangeCodeOutcome> {
    const seed = this.seedFromId(`${input.platform}:${input.code}`);
    return {
      outcome: 'granted',
      accessToken: `stub-access-${seed}`,
      refreshToken: `stub-refresh-${seed}`,
      // A plausible platform-issued lifetime, long enough that the daily
      // refresh-social-tokens job (ADR-0049) is what actually keeps rotation
      // frequent, not the token's own natural expiry.
      expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
      scope: ['public_profile', 'basic_insights'],
      platformUserId: `stub-platform-user-${seed}`,
      platformHandle: `@creator${seed % 10000}`,
    };
  }

  async refreshToken(input: {
    platform: string;
    refreshToken: string;
  }): Promise<RefreshTokenOutcome> {
    const seed = this.seedFromId(`${input.platform}:${input.refreshToken}`);
    return {
      outcome: 'refreshed',
      accessToken: `stub-access-${seed}-r`,
      refreshToken: `stub-refresh-${seed}-r`,
      expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
    };
  }

  private seedFromId(id: string): number {
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = (hash * 31 + id.charCodeAt(i)) % 1_000_003;
    }
    return Math.abs(hash);
  }
}
