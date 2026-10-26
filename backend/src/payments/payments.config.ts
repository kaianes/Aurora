// Tunable thresholds live in a typed config object, not the database or
// hardcoded inline, mirroring content-workflow.config.ts's own precedent.

// ADR-0034: the committed payout window default. A config value, supplied
// at deploy time (NFR-30), not stored per campaign or per opportunity.
// Governs only future obligations: an already-created
// payout_obligation.committed_deadline_at is immutable and is never
// recomputed if this value changes later.
export const PAYOUT_WINDOW_DAYS = parseInt(process.env.PAYOUT_WINDOW_DAYS || '5', 10);

// Section 3.2 of the E6 architecture doc: the lead time before
// committed_deadline_at at which an unsettled obligation is escalated for
// manual review (mirrors ADR-0030's exact precedent).
export const PAYOUT_ESCALATION_LEAD_HOURS = parseInt(
  process.env.PAYOUT_ESCALATION_LEAD_HOURS || '24',
  10,
);

// Section 5 cron cadences.
export const POLL_IN_FLIGHT_PAYOUTS_CRON = '*/15 * * * *';
export const RETRY_UNEXECUTED_PAYOUTS_CRON = '*/30 * * * *';
export const ESCALATE_STALLED_PAYOUTS_CRON = '*/15 * * * *';
export const NOTIFY_OVERDUE_PAYOUT_FAILURES_CRON = '*/15 * * * *';
export const RECONCILE_LEDGER_CRON = '0 3 * * *';

// notify-overdue-payout-failures' crashed-enqueue guard (same precedent as
// E2's expire-pending-quotes): only re-enqueues a notification whose first
// failure is older than this, so the inline enqueue has had a chance to run.
export const NOTIFY_OVERDUE_GUARD_MINUTES = 5;

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}
