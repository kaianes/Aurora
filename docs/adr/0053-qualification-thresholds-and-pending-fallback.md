# ADR-0053: Qualification Thresholds Set as a Pilot Default; Decision Evaluated Synchronously With an Explicit Pending Fallback

**Status:** Proposed
**Date:** 2026-10-21
**Epic:** E8 -- Creator Recruitment and Growth
**Governs:** US-24.4, FR-11, NFR-24, NFR-26

## Context

FR-11 requires Aurora to "inform a creator, at the end of onboarding, whether they currently qualify for campaigns and what specifically is missing if they do not." The PRD defines no actual qualification criteria anywhere -- not a minimum audience size, not a minimum engagement rate, not any other threshold -- leaving US-24.4 scenario 2's "falls short of a specific published criterion (for example, engagement rate or audience size below the minimum)" as an example, not a specification. This is exactly the kind of unstated numeric threshold prior epics have each had to fill with an explicit, flagged architectural default rather than leaving unbuildable (ADR-0017's authenticity thresholds, ADR-0046's cost-efficiency formula, ADR-0044's ingestion cadence are the direct precedents).

A second, structurally separate question is what happens when the decision genuinely cannot be made yet (US-24.4 scenario 3: metrics still computing when she reaches the final onboarding step). The story is explicit that this must not mean "wait indefinitely" or "fail silently" -- it requires a stated expected timeframe and an eventual notification.

Options considered for the threshold content:

- **No threshold at all; qualify everyone with at least one linked account.** Rejected: this makes FR-11's "what specifically is missing if they do not" clause meaningless, since nobody would ever fail, and contradicts US-24.4 scenario 2's explicit expectation that some creators do not qualify on a named criterion.
- **Include authenticity score as a qualification criterion** (e.g., require `authenticity_score >= 50`). Rejected: this would make a fraud-detection model's output capable of excluding a creator from the platform entirely, directly contradicting ADR-0017's "never an automatic exclusion" policy and ADR-0052's explicit extension of that policy to this epic. Authenticity stays a display-only fact at every layer of this platform, including this one.
- **A small set of simple, auditable thresholds on data this epic itself computes**: at least one linked social account (the literal FR-08 precondition), a minimum audience size, and a minimum engagement rate.

Options considered for the pending case:

- **Block the final onboarding step until the decision is ready**, i.e., make her wait synchronously. Rejected: directly contradicts the scenario's own "does not force her to wait indefinitely," and risks blowing NFR-24's 10-minute budget on a single step whose latency this epic cannot fully control (an adapter failure's retry/backoff timeline).
- **Let her finish onboarding regardless, with `onboarding_status = pending` as a fully legitimate, user-visible terminal state for that session**, paired with an expected-readiness timestamp and a later notification once resolved.

## Decision

Qualification (evaluated by `compute-creator-metrics`, E8 architecture doc section 9, immediately after `CreatorAudienceInsightsAdapter` and `AuthenticityScoringAdapter` both resolve) requires all of:

1. At least one `creator_social_account` with `status = connected` (the FR-08 precondition, literally).
2. `audience_size >= 500`.
3. `engagement_rate >= 1.0` (percent).

All three thresholds are an explicit architectural default for this pilot, set here rather than left unbuildable, and are recorded as open to product revision once real score/audience distributions exist to calibrate against -- the identical posture ADR-0017 already took for its own numeric thresholds. They live in a single configuration object (`qualification-config.ts`, mirroring `matching-config.ts`'s precedent in `backend/src/matching`), not hardcoded inline and not in the database, so they can be recalibrated without a migration (the same NFR-29-style modifiability property ADR-0017's own thresholds already have). `authenticity_score`/`authenticity_status` are **never** referenced by this rule, by design (ADR-0052).

A creator who fails criterion 2 or 3 gets `onboarding_status = not_qualified` and `qualification_missing_criteria` populated with the specific failed keys (`min_audience_size`, `min_engagement_rate`) -- never a generic rejection message, satisfying US-24.4 scenario 2's explicit requirement.

**The pending fallback** applies only when `CreatorAudienceInsightsAdapter` or `AuthenticityScoringAdapter` itself returns a transient failure (`rate_limited`/`unreachable`) rather than a successful result the rule can evaluate -- not when the rule evaluates successfully and simply fails a threshold (that is `not_qualified`, a decided outcome, not a pending one). On a transient failure, `onboarding_status` stays `pending`, `qualification_expected_ready_at` is set to `now() + 5 minutes` (a pilot-default expectation, chosen because every adapter in this pilot is a deterministic stub that resolves in well under a second under normal operation -- the 5-minute figure exists to give the retry/backoff sequence genuine room, not because the stub itself is ever actually slow), and the job retries on backoff. Once it eventually resolves (qualified or not_qualified), `qualification_notified_at` is set and a notification email is enqueued via the existing `email` queue if she is no longer in the live onboarding session.

## Consequences

**What Aurora gains:**
- FR-11's "what specifically is missing" clause has a concrete, testable meaning: `qualification_missing_criteria` is a small, named, finite set of keys, not a free-text guess.
- Authenticity's exclusion from this rule is consistent, not just with ADR-0017's original scope (matching/shortlist) but now with every gate in the creator's journey from first metrics computation through qualification through matching -- a single, platform-wide guarantee that a fraud-detection signal never removes a legitimate creator's livelihood on its own, at any of the three points it could plausibly have been wired in.
- The pending case is a designed, user-communicated state rather than an edge case the frontend has to improvise a message for -- `qualification_expected_ready_at` and the later email notification are both concrete, buildable fields and jobs.

**What Aurora gives up:**
- The specific numbers (500 followers, 1.0% engagement, 5-minute expected readiness) are product judgment calls made here under the same instruction prior epics' thresholds were made under: resolve rather than defer, flagged explicitly as a default. A real nano-creator population's actual distribution may argue for different numbers once observed, requiring only a config change, not a migration or code change, to revise.
- A creator who fails qualification on her first attempt has no explicit "try again later once your metrics improve" re-evaluation endpoint in this epic's scope -- she can relink or wait for the scheduled `refresh-creator-audience-metrics` job (every 12 hours) to update her figures, but nothing in this epic re-runs the qualification rule automatically after that refresh. This is accepted as a reasonable pilot-scope limitation: re-evaluating qualification continuously would need its own trigger design (on every metrics refresh? on a schedule? on creator request?) that no story in this epic specifies, and inventing one unprompted risks building a feature nobody asked for.

**Risk:** None of this rule's three thresholds have been validated against a real nano-creator population's actual audience-size/engagement distribution, the same category of unvalidated-assumption risk `docs/architecture.md`'s own R-01 names for the brand-safety escalation rate. Mitigation: the thresholds are isolated in one configuration object specifically so recalibration is cheap once real qualification outcomes can be observed and reviewed.
