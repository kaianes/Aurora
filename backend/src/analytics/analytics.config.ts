// Tunable thresholds live in a typed config object, not the database or
// hardcoded inline, mirroring content-workflow.config.ts's and
// payments.config.ts's own precedent.

// ADR-0044: a fixed, platform-wide cadence, an architectural default sized
// against NFR-08 (section 1 of the E7 architecture doc).
export const DISCOVER_AND_INGEST_METRICS_CRON = '0 */4 * * *';

// ADR-0044 / section 4.2 of the E7 architecture doc: an auth_revoked outcome
// waits 24 hours before its next retry, since this is not expected to
// self-resolve without a creator reconnecting her account (E8 scope).
export const AUTH_REVOKED_RETRY_HOURS = parseInt(
  process.env.ANALYTICS_AUTH_REVOKED_RETRY_HOURS || '24',
  10,
);

export function derivePlatformFromFormat(format: string | null | undefined): string {
  // Deliverable formats in this codebase are named "<platform>_<kind>"
  // (e.g. "instagram_reel", "instagram_story" -- campaign/matching-engine.
  // adapter.spec.ts and the briefing/opportunity fixtures across E2/E3/E5).
  // platform is derived once, at snapshot-row creation, and never changes
  // (section 2.2 of the E7 architecture doc).
  if (!format) return 'instagram';
  const platform = format.split('_')[0];
  return platform || 'instagram';
}
