// Tunable thresholds live in a typed config object, not the database or
// hardcoded inline, mirroring matching-config.ts's/payments.config.ts's own
// precedent (ADR-0053, NFR-29).

// ADR-0053: qualification requires all three. Authenticity is never
// referenced here, by design (ADR-0052) -- a fraud-detection signal never
// removes a legitimate creator's livelihood on its own.
export const QUALIFICATION_THRESHOLDS = {
  minAudienceSize: 500,
  minEngagementRate: 1.0, // percent
};

export enum QualificationCriterion {
  AT_LEAST_ONE_LINKED_ACCOUNT = 'at_least_one_linked_account',
  MIN_AUDIENCE_SIZE = 'min_audience_size',
  MIN_ENGAGEMENT_RATE = 'min_engagement_rate',
}

// ADR-0053: a pilot-default expectation for the pending fallback, chosen
// because every adapter in this pilot is a deterministic stub resolving in
// well under a second under normal operation -- this figure exists to give
// the retry/backoff sequence genuine room, not because the stub is slow.
export const QUALIFICATION_PENDING_EXPECTED_READY_MINUTES = 5;

// ADR-0049: a creator's invitation and the OAuth CSRF state both carry
// short, bounded lifetimes.
export const CREATOR_INVITATION_EXPIRY_DAYS = 7;
export const OAUTH_STATE_EXPIRY_MINUTES = 10;

// NFR-20: an unclaimed profile's retention window.
export const UNCLAIMED_PROFILE_EXPIRY_DAYS = 90;

// NFR-21 / ADR-0056: LGPD data-subject request fulfillment window.
export const DATA_SUBJECT_REQUEST_DUE_DAYS = 15;

// ADR-0058: a single, flat, currency-denominated ceiling applied uniformly
// across every deliverable format.
export const RATE_PREFERENCE_MAX_AMOUNT = 50000;

// ADR-0049: proactive rotation window -- any connected token within this
// many days of its platform-issued expiry is refreshed by the daily
// refresh-social-tokens job, well before the 90-day NFR-15 ceiling.
export const TOKEN_REFRESH_LEAD_DAYS = 7;

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}
