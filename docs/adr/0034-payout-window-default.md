# ADR-0034: A Configurable Five-Day Payout Window Default, Fixed Platform-Wide

**Status:** Proposed
**Date:** 2026-10-21
**Epic:** E6 -- Payments and Financial Transparency
**Governs:** US-29, US-35a, US-35b, FR-43, FR-45

## Context

FR-43 requires displaying "the expected payment date" before a creator accepts an opportunity; FR-45 requires executing "each payout within the window committed to the creator at the time of acceptance." Neither the PRD nor the stories document states a number: PRD open question 1 is explicit that "the business analysis names the pain being solved -- sixty days or more, with no visibility -- but no section of the PRD states the replacement target as a number of days, nor whether that window is one fixed platform-wide constant or configurable per campaign or creator." Backend-dev cannot build `payout_obligation.committed_deadline_at` (or anything FR-45 depends on) without one concrete rule, and this document's own data model (section 3.2 of the E6 architecture document) needs a formula, not a placeholder.

Two structural choices were available: a fixed, platform-wide constant, or a configurable value set per campaign or per creator (which the open question explicitly raises as a possibility). A per-campaign or per-creator window would require either a new field on `campaign` (reaching into E2's schema, which this epic's own integration discipline, section 2 of the E6 architecture document, deliberately avoids touching) or a new field on `campaign_opportunity` (reaching into E3's immutable, trigger-locked payout surface, which section 2.2 of the same document explicitly commits to never writing to). Both options widen this epic's footprint into tables two other epics already own and have locked down, for a degree of flexibility no story actually asks for -- no acceptance criterion in US-29, US-35a, or US-35b describes a window that varies by campaign or creator; they describe "the committed window" as a single, already-known quantity.

## Decision

**`PAYOUT_WINDOW_DAYS` is a single, platform-wide, externally configured constant**, defaulting to **5 calendar days** from the moment `content_submission.published_at` is set (i.e., from publication confirmation, not from acceptance, not from the opportunity's own `expires_at`). It is read from the environment at deploy time (NFR-30-consistent, the same precedent ADR-0030 already set for E5's own review-deadline default), not hardcoded and not stored per campaign or per opportunity:

```typescript
export const PAYOUT_WINDOW_DAYS = parseInt(process.env.PAYOUT_WINDOW_DAYS || '5', 10);
```

Five days is not derived from any stated requirement -- it is a plausible pilot value, chosen because it is a dramatic, easily communicated improvement over the "sixty days or more" pain the business analysis names, while remaining generous enough that this pilot's manual settlement fallback (ADR-0033) has a realistic window for an `aurora_operator` to act in without the pressure of a same-day or next-day deadline. It governs only *future* obligations: an already-created `payout_obligation.committed_deadline_at` is immutable (section 3.6 of the E6 architecture document) and is never recomputed if the configured value changes later.

## Consequences

**What Aurora gains:**
- FR-45's obligation has one concrete, buildable rule: `committed_deadline_at = published_at + PAYOUT_WINDOW_DAYS`, computed once, at `payout_obligation` creation, with no dependency on any other epic's schema.
- The window length is a one-line configuration change, not a schema or code change, if 5 days proves wrong in either direction during the pilot -- the same tuning cost ADR-0030 already established as cheap for its own deadline default.
- A single platform-wide constant is trivially explainable to a creator ("Aurora pays within 5 days of your post going live, every time"), which is itself part of the value being sold against the sixty-day status quo -- a per-campaign or per-creator variant would have to be explained differently depending on context, undermining the simplicity of the promise.

**What Aurora gives up:**
- No campaign can promise a shorter or longer window than any other, even if a future brand negotiation or a specific creator tier wanted one -- that flexibility, if product ever wants it, is a new field on `campaign_opportunity` (reached through E3's own change process, not this epic's) plus a migration, not a configuration change.
- 5 days is a guess, not a measured value, in the same category of risk ADR-0030 and `docs/architecture.md`'s R-01 already name for their own unvalidated pilot defaults. If a real payment provider's actual settlement latency (even for Pix, which settles in seconds once instructed) turns out to make 5 days too tight given this pilot's manual-fallback dependency (ADR-0033), the escalation and reconciliation signals (section 5 of the E6 architecture document) will surface that as an operational metric, not as a silent miss.

**Risk:** The 5-day default is unvalidated against this pilot's actual manual-settlement throughput -- the same category of risk ADR-0030 already names for its own 48-hour default. Mitigation: treat the settled-on-time ratio (`docs/architecture.md` Table 14's existing NFR-11 signal) as a monitored rate from the first live obligation onward, and revisit the default once real data exists, exactly as ADR-0030's own mitigation prescribes.
