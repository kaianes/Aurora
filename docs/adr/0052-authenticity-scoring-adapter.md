# ADR-0052: Authenticity Scoring as Its Own Adapter, Extending ADR-0017's Flag-Only Policy to a Real Input

**Status:** Proposed
**Date:** 2026-10-21
**Epic:** E8 -- Creator Recruitment and Growth
**Governs:** US-24.3, FR-10, NFR-24

## Context

FR-10 requires Aurora to "compute an authenticity score per creator that detects follower fraud and anomalous engagement patterns." E3 already built the *display and policy* half of this requirement before any real computation existed: `creator.authenticity_score` (a nullable numeric column), `GET /creators/:id/metrics`'s `authenticity_flag` field, and ADR-0017's explicit, carefully-reasoned "flag-only, two-tier threshold, never an automatic exclusion" policy. ADR-0017's own context section states plainly that the threshold number "has to exist somewhere for the 'prominently surfaced' requirement... to mean anything concrete" -- but no story before this epic ever produced a real score for that threshold to apply to; E3's pilot-seeded creators simply had `authenticity_score = null` or a manually-seeded placeholder.

Two structural questions needed answering: where does the actual score computation live, and what happens when a reliable score cannot yet be produced (US-24.3 scenario 3's explicit "too new or too little activity for the fraud-detection model to produce a confident result").

Options considered for where the computation lives:

- **Fold authenticity scoring into `CreatorAudienceInsightsAdapter`** (ADR-0051), since both run against the same linked social account at roughly the same moment. Rejected: fraud/anomaly detection is a conceptually and often commercially distinct capability from audience demographics -- a real implementation is plausible as a specialized third-party fraud-detection vendor (the kind of service that specifically analyzes follower-growth patterns and engagement anomalies) rather than the same platform API call that returns audience size and niche. Coupling the two into one adapter call would force a future swap of either capability to touch the other's interface, which NFR-29's modifiability principle (applied platform-wide, not just to matching and safety) argues against.
- **A separate `AuthenticityScoringAdapter`**, called after `CreatorAudienceInsightsAdapter` succeeds (since a fraud model plausibly wants audience size and engagement rate as inputs, not just raw platform access), stub-only in this pilot.

For the "not enough data" case, two options:

- **Default to a middle-of-the-road score** (e.g., 50) when the model cannot produce a confident result. Rejected outright: US-24.3 scenario 3 explicitly forbids this ("Aurora does not fabricate a score... rather than defaulted to a number that implies a judgment it cannot support"), and a fabricated middle score would be actively misleading under ADR-0017's own "prominently surfaced" rendering rule -- a fake 50 could look like a genuine "review" tier.
- **A distinct, first-class `insufficient_data` state**, never collapsed into a numeric score.

## Decision

`AuthenticityScoringAdapter` (E8 architecture doc section 3.3) is defined and owned by `creator-network`, called by the same `compute-creator-metrics` job that calls `CreatorAudienceInsightsAdapter`, immediately after it succeeds, using its output (`audienceSize`, `engagementRate`) as input signals:

```typescript
scoreAuthenticity(input: { creatorId, socialAccountId, audienceSize, engagementRate }):
  Promise<{ outcome: 'scored'; score: number } | { outcome: 'insufficient_data' }>
```

`creator.authenticity_status` (`pending | scored | insufficient_data`, new column) is the durable record of which of the three states applies -- `authenticity_score` alone being `null` was ambiguous between "never attempted," "scored as genuinely low," and "could not be scored," which this column resolves. `StubAuthenticityScoringAdapter` always returns `scored` with a deterministic, synthetic value in normal pilot operation (consistent with every other stub in this codebase defaulting to the success path); `insufficient_data` is exercised only in integration tests against a mock, exactly as `SocialMetricsAdapter`'s and `CreatorAudienceInsightsAdapter`'s own failure branches are (ADR-0044, ADR-0051).

**This epic does not touch ADR-0017 at all.** The two-tier threshold (`< 50` = low, `50-69` = review, `>= 70` = none), the "never an automatic exclusion from matching" rule, and the "prominently rendered, never hidden" frontend contract all continue to apply unchanged to whatever score this adapter produces. `insufficient_data` is a fourth state the *display* layer (E3's `GET /creators/:id/metrics` response) must render distinctly from all three flag tiers -- an additive change to that endpoint's response shape (adding `authenticity_status` alongside the existing `authenticity_flag`), not a change to ADR-0017's policy itself. Crucially, **a `pending` or `insufficient_data` authenticity state never blocks US-24.4's qualification decision**: consistent with ADR-0017's own "never an automatic exclusion," this epic's qualification rule (ADR-0053) does not include authenticity as a pass/fail criterion at all, only audience size, engagement rate, and having at least one linked account -- authenticity remains purely a display fact for Marina/Renata to weigh, never a gate Duda has to clear.

## Consequences

**What Aurora gains:**
- A real, honest authenticity signal now flows into the display mechanism E3 already built and carefully policy-constrained, without that policy needing to be revisited or loosened under the pressure of "but now we have a real low score to deal with" -- ADR-0017's reasoning was sound in the abstract and remains sound now that it governs real data.
- The "not enough data" case is a first-class, named state rather than a null value doing double or triple duty, which directly satisfies US-24.3 scenario 3's explicit anti-fabrication requirement and gives the frontend an unambiguous state to render ("we're still gathering enough signal" is a materially different message than "this creator's score is unavailable for an unstated reason").
- Keeping authenticity out of the qualification gate (consistent with keeping it out of the matching gate, ADR-0017) means a creator is never blocked from campaigns by a model that is, by the model's own admission, not confident yet -- the same "flag, don't exclude" philosophy applied one layer earlier in her journey than E3 originally applied it.

**What Aurora gives up:**
- A separate adapter for fraud/anomaly detection is one more piece of pilot-stub surface area to eventually replace with a real integration (likely a third-party vendor relationship, not a platform API call), adding to the list of real integrations this project still owes (`SocialAuthAdapter`, `CreatorAudienceInsightsAdapter`, `PayoutExecutionAdapter`, `SocialMetricsAdapter`, now a fifth). This is accepted as the honest cost of sequencing: building and exercising the rest of this epic's qualification/display logic against a predictable stub now is worth more than guessing at a real fraud-detection vendor's interface before evaluating one.

**Risk:** Because the stub always returns `scored` with a plausible synthetic value, this pilot cannot demonstrate the `insufficient_data` path against real user behavior, only against a mock in a test -- the same honesty tradeoff ADR-0044 already named for `SocialMetricsAdapter`'s synthetic data. Mitigation: explicitly recorded here rather than hidden; a real adapter implementation is the natural point to validate this path against genuinely new or low-activity accounts.
