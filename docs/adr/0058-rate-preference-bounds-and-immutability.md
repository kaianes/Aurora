# ADR-0058: Rate Preference Validity Bounds Set as a Pilot Default; Immutability Relies Entirely on E3's Existing Opportunity-Snapshot Trigger

**Status:** Proposed
**Date:** 2026-10-21
**Epic:** E8 -- Creator Recruitment and Growth
**Governs:** US-27, FR-15

## Context

FR-15 allows a creator to "record rate preferences per deliverable format" but, per the stories document's own open question 6, "does not define what makes a rate valid (currency, minimum, maximum, or whether it must be a single number versus a range)." US-27 scenario 3 requires the system to "reject the input with a clear reason" for a rate that is "negative, zero, or implausibly high" and to "never silently clamp, round, or otherwise substitute a different number" -- a concrete behavioral requirement that cannot be built without first deciding what counts as implausible.

A second question, structurally distinct from the bounds themselves, is how US-27 scenario 2's non-retroactivity guarantee ("the change applies only to opportunities created from that point forward. Any already-created opportunity keeps its original payout figures unchanged") is actually enforced -- whether this epic needs its own immutability mechanism or can rely on one that already exists.

Options considered for the bounds:

- **No validation beyond "not negative or zero."** Rejected: this would not satisfy scenario 3's explicit "implausibly high" example, leaving that half of the acceptance criterion unbuildable.
- **A currency-aware, format-specific ceiling** (e.g., a different maximum for an Instagram Reel versus a YouTube video, reflecting real-world rate variance by format). Rejected for this pilot as more precision than the available signal supports: no story or NFR gives this architecture any basis for format-specific numbers, and inventing several different plausible-sounding ceilings would look more authoritative than the evidence behind them actually is.
- **A single, flat, currency-denominated ceiling applied uniformly across every deliverable format**, generous enough not to constrain a legitimate nano-creator rate for any format, but low enough to catch an obvious data-entry error (e.g., an extra zero, or a rate quoted in the wrong unit).

Options considered for immutability enforcement:

- **A versioned rate-preference history table**, so a "rate as of a given opportunity's creation" can always be reconstructed independently. Rejected as unnecessary duplication: E3's architecture document (section 2.5) already enforces, with a database trigger, that `campaign_opportunity.payout_gross/commission/net` are immutable once created -- whatever rate was used to compute those figures at creation time is already permanently frozen on the opportunity row itself. A creator-side history of past rates would answer a question ("what did she used to charge") nothing in this epic's own stories actually asks.
- **A current-value-only table**, relying entirely on E3's existing opportunity immutability for the retroactivity guarantee.

## Decision

`creator_rate_preference.rate_amount` is constrained to `> 0 AND <= 50000` (BRL), enforced by a database `CHECK` constraint (E8 architecture doc section 2.5), not merely application-level validation -- the same "the database is the backstop, the application is the convenience layer" discipline `docs/architecture.md` section 4.2 already states for row-level security, applied here to a data-integrity rule instead of a tenancy one. `currency` defaults to `BRL`; no multi-currency support is built, consistent with NFR-27's Brazilian-Portuguese-primary-market framing and the complete absence of any other multi-currency concern anywhere else in this codebase's existing financial tables (`invoice`, `payout_obligation`, `ledger_entry` are all implicitly BRL). The 50,000 ceiling is an explicit, flagged architectural default -- generous enough that no plausible single-deliverable nano- or micro-creator rate would be rejected, low enough to catch an obvious data-entry error -- not a confirmed product decision, resolving the stories document's open question 6 the same way every other unstated-threshold gap in this project has been resolved (ADR-0017, ADR-0046, ADR-0053).

`creator_rate_preference` carries **no history or versioning of its own**. US-27 scenario 2's non-retroactivity guarantee is satisfied entirely by E3's pre-existing `prevent_opportunity_payout_mutation` trigger (E3 architecture doc section 2.5): whatever module computes `campaign_opportunity.payout_gross/commission/net` at opportunity-creation time reads whatever `creator_rate_preference` row exists at that moment, and the resulting figures are then permanently frozen on the opportunity itself, independent of anything this epic's table does afterward. This epic adds no new enforcement for that guarantee because none is needed -- the guarantee already exists, one layer downstream, for an unrelated reason (payout integrity, not rate-preference history).

## Consequences

**What Aurora gains:**
- A concrete, enforced, database-level bound exists for US-27 scenario 3's rejection behavior, satisfied with a single `CHECK` constraint rather than scattered applica­tion-level validation that a future code path could bypass.
- Zero duplicated immutability logic: this epic's non-retroactivity promise rides entirely on a trigger E3 already built and tested for its own, independent reason, which is the cheapest possible way to satisfy US-27 scenario 2 -- by recognizing that the guarantee it needs already exists elsewhere rather than building a second one.
- `creator_rate_preference`'s simplicity (one current row per format, no history) keeps this epic's one `Could`-priority story's implementation cost proportionate to its priority.

**What Aurora gives up:**
- There is no way, within this epic's own data, to answer "what rate did Duda have on file last March" -- only E3's `campaign_opportunity` rows, each frozen at its own creation time, can reconstruct a historical rate, and only for opportunities that were actually created, not for every rate she ever set. This is accepted as proportionate to a `Could`-priority story with no stated historical-reporting requirement.
- The 50,000 BRL ceiling and the BRL-only currency assumption are both pilot-scoped defaults that would need revisiting before any international expansion or before any creator legitimately needs a higher per-deliverable rate than this ceiling permits (e.g., a larger micro- or mid-tier creator Aurora might recruit later) -- a config-level change (raising the `CHECK` constraint's bound), not a schema redesign, when that need arises.

**Risk:** A flat, format-independent ceiling cannot distinguish "implausibly high for an Instagram Story" from "entirely normal for a YouTube long-form video," meaning the single ceiling is necessarily a compromise across formats with genuinely different real-world rate ranges. Mitigation: the ceiling is set high enough that this is very unlikely to bind against any real pilot-scale creator's legitimate rate for any format; if a future format's typical rate regularly approaches or exceeds it, that is a signal to revisit the constant, not evidence the mechanism itself is wrong.
