import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { OAUTH_STATE_EXPIRY_MINUTES, addMinutes } from './creator-network.config';

interface OAuthStateEntry {
  creatorId: string;
  platform: string;
  expiresAt: Date;
}

// Section 5.3 of the E8 architecture doc: a CSRF state value bound
// server-side to (creator_id, platform, expires in 10 minutes), resolved
// and invalidated exactly once at the callback (section 5.4) -- an invalid,
// expired, or reused state returns 400 INVALID_OAUTH_STATE. The
// architecture's own data model (section 2) deliberately does not persist
// this short-lived nonce as a table; this pilot holds it in process memory,
// which is correct at this pilot's single-instance scale but would need a
// shared store (e.g. Redis, already named platform-wide for queues/caching)
// behind a future multi-instance deployment.
@Injectable()
export class OAuthStateService {
  private readonly states = new Map<string, OAuthStateEntry>();

  create(creatorId: string, platform: string): string {
    this.sweepExpired();
    const state = crypto.randomBytes(24).toString('base64url');
    this.states.set(state, {
      creatorId,
      platform,
      expiresAt: addMinutes(new Date(), OAUTH_STATE_EXPIRY_MINUTES),
    });
    return state;
  }

  // Single-use: resolving a state removes it, so a reused value is
  // indistinguishable from an unknown one.
  consume(state: string): { creatorId: string; platform: string } | null {
    const entry = this.states.get(state);
    if (!entry) return null;
    this.states.delete(state);
    if (entry.expiresAt < new Date()) return null;
    return { creatorId: entry.creatorId, platform: entry.platform };
  }

  private sweepExpired() {
    const now = new Date();
    for (const [key, entry] of this.states.entries()) {
      if (entry.expiresAt < now) this.states.delete(key);
    }
  }
}
