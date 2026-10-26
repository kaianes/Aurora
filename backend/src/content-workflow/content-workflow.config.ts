// Tunable thresholds live in a typed config object, not the database or
// hardcoded inline, mirroring brand-safety.config.ts's own precedent.

// ADR-0030: the review-deadline default. A config value, not a hardcoded
// constant -- supplied at deploy time (NFR-30), open to revision without a
// migration. Governs only future submissions; an already-set
// review_deadline_at on an existing row is never recomputed retroactively.
export const DRAFT_REVIEW_SLA_HOURS = parseInt(process.env.DRAFT_REVIEW_SLA_HOURS || '48', 10);

// escalate-overdue-draft-reviews sweeper cadence (ADR-0030, section 5 of the
// E5 architecture doc): every 15 minutes.
export const ESCALATE_OVERDUE_REVIEWS_CRON = '*/15 * * * *';
