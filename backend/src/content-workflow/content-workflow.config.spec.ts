import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// US-32b / ADR-0030: the review-deadline default is a config value supplied at deploy time
// (NFR-30), defaulting to 48 hours for the pilot when no override is set, and overridable
// without a code or migration change.
describe('content-workflow.config - US-32b', () => {
  const ORIGINAL_ENV = process.env.DRAFT_REVIEW_SLA_HOURS;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.DRAFT_REVIEW_SLA_HOURS;
    } else {
      process.env.DRAFT_REVIEW_SLA_HOURS = ORIGINAL_ENV;
    }
    vi.resetModules();
  });

  it('defaults DRAFT_REVIEW_SLA_HOURS to 48 when no environment override is set', async () => {
    delete process.env.DRAFT_REVIEW_SLA_HOURS;
    const { DRAFT_REVIEW_SLA_HOURS } = await import('./content-workflow.config');
    expect(DRAFT_REVIEW_SLA_HOURS).toBe(48);
  });

  it('honors an environment override without any code change (NFR-30)', async () => {
    process.env.DRAFT_REVIEW_SLA_HOURS = '72';
    const { DRAFT_REVIEW_SLA_HOURS } = await import('./content-workflow.config');
    expect(DRAFT_REVIEW_SLA_HOURS).toBe(72);
  });

  it('runs the escalation sweeper every 15 minutes', async () => {
    const { ESCALATE_OVERDUE_REVIEWS_CRON } = await import('./content-workflow.config');
    expect(ESCALATE_OVERDUE_REVIEWS_CRON).toBe('*/15 * * * *');
  });
});
