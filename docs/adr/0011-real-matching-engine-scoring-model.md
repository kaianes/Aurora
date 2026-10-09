# ADR-0011: Real Matching Engine as a Weighted, Multi-Signal Scoring Model Behind the Existing Adapter Interface

**Status:** Proposed
**Date:** 2026-10-05
**Epic:** E3 -- Creator Matching and Curation
**Governs:** US-11, FR-25, FR-26, NFR-01, NFR-06, NFR-29

## Context

E2 shipped `StubMatchingEngineAdapter`, a deterministic placeholder that estimates pool size and price from targeting narrowness alone, with no real creator data behind it. E3 must replace this with a real engine that ranks actual creators against a campaign's audience targeting and brand profile, within a 60-second p95 for up to 100 creators (NFR-01), scaling to 150 (NFR-06), and swappable later without touching campaign or payment code or requiring a migration (NFR-29).

Two broad approaches were considered:

- **A learned ranking model** (e.g., a gradient-boosted ranker or embedding-based similarity search) trained on historical campaign-creator performance. This is the right long-term direction once Aurora has campaign outcome data to train on, but at pilot launch there is no historical performance data yet (the first campaigns under E3 would have nothing to learn from), and operating a model-serving pipeline is a substantial new piece of infrastructure for a small team to run and debug under a 60-second latency budget.
- **A transparent, weighted multi-signal score**, computed in SQL/application code from fields already in (or added to) the `creator` table: audience-attribute fit, authenticity score, engagement rate, and (once available) historical reliability. Each signal is explainable, which directly serves FR-26 ("state the specific campaign attributes that creator satisfied") and US-12's trust requirement -- a weighted sum is easy to explain to Marina; a learned ranker's output is not, without building a separate explanation layer.

## Decision

E3 ships `RealMatchingEngineAdapter`, a weighted multi-signal scorer, not a learned model, for the pilot. The score for a candidate creator against a campaign is:

```
fit_score = w1 * audience_attribute_match   // fraction of targeting attributes (geography, interests, age_range, gender) satisfied
          + w2 * (authenticity_score / 100) // normalized 0-1
          + w3 * engagement_rate_percentile // normalized against the current eligible pool, not an absolute cutoff
          + w4 * historical_reliability     // completion rate of past opportunities (accepted-and-published / accepted); defaults to a neutral 0.5 for creators with no history
```

Default weights (`w1=0.4, w2=0.25, w3=0.2, w4=0.15`) are configuration, not schema -- they live in a typed config object inside the `matching` module, not a database row, so they can be tuned or A/B'd without a migration. Candidates failing a hard eligibility gate (excluded by `creator_exclusion`, `status != active`, `onboarding_status != qualified`, or zero audience-attribute overlap) never enter scoring at all; exclusion and eligibility are filters applied before ranking, consistent with FR-27's "applied before a shortlist is produced, not filtered out afterward."

Scoring runs as a single query over the filtered candidate set (bounded by `maxCandidates = 150` per NFR-06), computing all four signals in one pass, then sorting. `matched_attributes` (FR-26) is derived directly from which targeting dimensions contributed non-zero overlap to `w1`, so the explanation is a byproduct of the scoring computation itself, not a second pass.

The adapter is registered behind the `MatchingEngineAdapter` DI token `campaign` already consumes (E2 section 3.3.1), with one new method, `generateShortlist`, alongside the unchanged `estimatePool`.

## Consequences

**What Aurora gains:**
- A scoring model the team can build, debug, and explain within the pilot's timeline and headcount, with no new infrastructure (model-serving, feature store) beyond what already exists.
- Every ranking decision is traceable to specific, named signals, which satisfies both FR-26 directly and the trust goal behind US-12 ("so that I can trust the match instead of guessing").
- Weights are configuration, so tuning the model as Aurora learns what predicts a good match (NFR-29's "replaceable as it improves") requires a code/config change and a deploy, not a schema migration or a change to `campaign`'s quoting code.
- The hard eligibility gate (exclusions, status, onboarding) runs once, before scoring, which keeps the scoring pass itself proportional to the already-filtered candidate set, helping meet NFR-01 at 100-150 creators.

**What Aurora gives up:**
- A weighted sum is a weaker predictor than a model trained on real outcome data would eventually be. Aurora is explicitly deferring the higher-ceiling approach until there is campaign history to train on, which is consistent with the pilot's honest scope (per the PRD's framing of NFR-33/NFR-34 as metrics to track now and verify formally later).
- `historical_reliability`'s neutral default for creators with no history means early-pilot rankings lean more heavily on audience fit and authenticity than reliability, which is the correct bias for a cold-start network but will need revisiting once enough creators have a track record.

**Risks:**
- If weight tuning becomes a frequent, ad hoc activity, keeping weights in code rather than an admin-editable config table will start to feel like friction. This is an acceptable tradeoff for the pilot's scale and team size; moving weights to a database-backed config row (still no change to `campaign`'s code, since the adapter interface is unaffected either way) is a cheap follow-up if that friction materializes.
