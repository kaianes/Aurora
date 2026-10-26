// Tunable thresholds live in a typed config object, not the database or
// hardcoded inline, so they can change without a migration (ADR-0022's
// consequences section, NFR-29).

// Hard cutoff for a safety_check: well above NFR-03's 5-minute p95 target so
// the timeout mechanism itself never converts the already-budgeted slow
// tail into check_unavailable states (ADR-0022).
export const SAFETY_CHECK_TIMEOUT_MINUTES = 10;

// expire-pending-checks sweeper cadence (ADR-0022, section 4 of the E4
// architecture doc).
export const EXPIRE_PENDING_CHECKS_CRON = '*/2 * * * *';

// monitor-published-content cadence, a pilot default explicitly open to
// revision (ADR-0024, PRD open question 7).
export const MONITORING_CRON = '0 */6 * * *';

// Tier-1 escalates to tier-2 when a prohibited_topic rule finds only a
// partial (not full) word-overlap with the checked text -- not a confident
// match, not confidently clear either. Tier-2 (stub, swappable per
// ADR-0021) resolves ambiguity with a lower overlap bar.
export const TIER1_PROHIBITED_TOPIC_FULL_OVERLAP = 1;
export const TIER2_PROHIBITED_TOPIC_PARTIAL_OVERLAP = 0.5;
