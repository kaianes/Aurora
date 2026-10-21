# ADR-0046: Cost-Efficiency Figure Defined as Cost-Per-Engagement Plus a CPM-Equivalent, an Architectural Default

**Status:** Proposed
**Date:** 2026-10-21
**Epic:** E7 -- Analytics and Reporting
**Governs:** US-22, FR-53

## Context

FR-53 requires the exported report to contain "spend, delivered reach, engagement, and a cost efficiency" figure. The stories document names this gap explicitly, as its own open question 1: "No formula is specified anywhere in the PRD for 'cost efficiency'... cost per unit of reach, cost per engagement, a CPM-equivalent, or something else." Nothing in the product requirements, the business analysis, or any prior epic's architecture document states a formula, and this epic cannot ship US-22 without picking one -- a report that names a field called "cost efficiency" but leaves it blank is not a smaller version of FR-53, it is a different, unfinished requirement.

This also matters for a second consumer this epic was not originally asked to serve directly but ends up touching: the stories document's integration note states that E2's existing `reallocate-budget` job already depends on this epic producing "a cost-efficiency metric." Reading the actual job code (`backend/src/campaign/reallocation.processor.ts`), what it consumes is a normalized, relative `score` per pool member, used only to compare creators *against each other within one campaign* -- not an absolute, buyer-facing figure meant to be defended to a CFO. These are genuinely different numbers for genuinely different audiences, and conflating them would be a mistake: a CFO wants to know "what did this cost per unit of result," while E2's reallocation algorithm wants to know "which creators, this cycle, are outperforming the pool average." This ADR resolves only the first (US-22's buyer-facing figure); the second is resolved separately by ADR-0047, and the two are computed from the same underlying `content_submission_metric_snapshot` data without being the same calculation.

Three formulas were considered for the buyer-facing figure:

- **Cost per unit of reach alone** (e.g., cost per 1,000 reached, a CPM-equivalent). Familiar to a media buyer, consistent with the dashboard's own framing of the pool as "reach," but says nothing about whether that reach actually did anything -- a campaign that reached many people with no engagement would read as efficient on this measure alone, which undersells the report's own stated purpose (proving ROI, not proving reach).
- **Cost per engagement alone.** Captures whether the audience actually did something, but is a less familiar unit to someone used to media-buying vocabulary (a CMO or CFO defending a budget line is more likely to have intuition for "CPM" than for an unqualified "cost per engagement" figure with no benchmark).
- **Both, shown together, with neither implying the other is secondary.** Costs nothing extra to compute (both are a single division against figures this epic already has: `spend_amount`, `total_delivered_reach`, `total_delivered_engagement`), and gives Marina a number her finance audience recognizes (CPM) alongside the number that actually answers "did this work" (cost per engagement).

## Decision

The export report (section 5.3 of the E7 architecture document) states two figures under "cost efficiency," both computed only when `has_deliveries = true` (never fabricated as zero, per US-22 scenario 3):

```
cost_per_engagement = spend_amount / total_delivered_engagement        (BRL per engagement action)
cpm_equivalent       = (spend_amount / total_delivered_reach) * 1000   (BRL per 1,000 delivered reach)
```

`spend_amount` is `campaign.locked_price` or `invoice.total_amount`, per the precedence rule in section 3.4 of the architecture document -- this ADR does not revisit that figure's source, only what is divided by it. Both fields are `null`, never `0.00`, whenever `has_deliveries = false` or the relevant denominator (`total_delivered_reach`/`total_delivered_engagement`) is zero, consistent with the architectural discipline every division-based figure in this epic follows (section 2.6's database constraint ties this to `has_deliveries` structurally, not only by service-layer convention).

**This is an explicit architectural default, not a confirmed product decision**, in the same category as E6's ADR-0034 (the payout window length) and ADR-0035 (the expected-payment-date projection) -- both PRD gaps an epic had to fill to ship, both stated plainly as assumptions open to revision rather than hidden inside the implementation.

## Consequences

**What Aurora gains:**
- US-22 ships with a concrete, defensible figure instead of an unresolved placeholder, and the figure is computed entirely from data this epic already holds (no new input, no new table beyond what section 2 of the architecture document already defines).
- Showing both a CPM-equivalent and a cost-per-engagement figure means Marina's report speaks two audiences' native vocabulary at once -- a media-buying frame for a CMO, an outcome frame for anyone asking "but did it work" -- without this epic having to guess which one matters more to a given reader.
- Because both figures are simple divisions against already-computed totals, nothing about this decision couples the report to how metrics are ingested (ADR-0044) or stored (ADR-0045); a future change to the formula is a change inside the report-generation job only, never a schema migration.

**What Aurora gives up:**
- If product later states a different intended formula (a true ROI calculation incorporating estimated media value, a benchmark-relative efficiency score, or something else entirely), every already-generated report's `cost_per_engagement`/`cpm_equivalent` values reflect this document's assumption, not that later formula -- there is no retroactive recomputation built into this design, consistent with every other report in this epic being generated once, on request, rather than continuously recalculated (mirroring E6's `invoice` being a one-time, non-regenerated action per ADR-0039).
- Two figures instead of one adds a small amount of explanation surface to the report's own UI and PDF layout -- Marina's CMO or CFO has two numbers to make sense of instead of one, which this design accepts as a worthwhile tradeoff against the risk of a single figure reading as more authoritative or more complete than it is.

**Risk:** This formula is unvalidated against what Aurora's actual customers (Marina, Renata) would consider a meaningful "cost efficiency" figure for their own renewal conversations -- the same category of unmeasured-assumption risk `docs/architecture.md`'s R-01 already names for a different cost claim in this system. Mitigation: this ADR, like ADR-0034/ADR-0035 before it, states the assumption as plainly reversible, so a product decision to change the formula is a known, bounded piece of work (one job's calculation logic) rather than a schema or architecture change.
