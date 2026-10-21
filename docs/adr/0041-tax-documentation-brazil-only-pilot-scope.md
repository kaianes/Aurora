# ADR-0041: Tax Documentation Scoped to Brazil Only, Kept to One Simple Generated/Blocked State, for This Pilot

**Status:** Proposed
**Date:** 2026-10-21
**Epic:** E6 -- Payments and Financial Transparency
**Governs:** US-36b, FR-50

## Context

FR-50 requires generating "the tax documentation required for creator payouts in each jurisdiction it operates in," a Should-priority requirement. PRD open question 6 states the mechanics are "left entirely open by FR-50 itself... without naming which jurisdictions beyond the implicit Brazilian default, which specific document types apply, or the timing relative to settlement." The task producing this document explicitly instructs keeping US-36b simple, consistent with its Should priority, rather than building a general multi-jurisdiction tax engine no story or NFR actually asks for.

The only jurisdiction this platform's other decisions already assume is Brazil: `docs/architecture.md`'s technology stack names a Brazilian PSP and Pix specifically; NFR-27 fixes Brazilian Portuguese as the primary locale; the LGPD (not GDPR or any other regime) is the compliance framework named throughout section 4.3 of `docs/architecture.md`. Building for a second jurisdiction now would mean inventing document types, formats, and rules for a market this platform has no other evidence it will serve in this pilot.

## Decision

**Brazilian jurisdiction only**, for this release. `tax_document` (section 3.2 of the E6 architecture document) is generated automatically the moment a `payout_obligation` settles (automatic or manual), with exactly two states: `generated` (the referenced creator's `tax_id`, this epic's additive extension to `creator`, is present) or `blocked_missing_info` (it is not, with `missing_fields: ["tax_id"]` named explicitly, satisfying US-36b scenario 3's "clearly flags... what information is missing"). The document itself is a single, simple PDF per settled obligation -- gross, commission, net, settlement date, the creator's `tax_id`, and Aurora's own registration details -- not a jurisdiction-specific form modeled after any particular Receita Federal document type, since no story or FR names one. `tax_period` is derived from `settled_at` (e.g., `YYYY-MM`), and is attached one-to-one with the obligation that produced it (unique on `payout_obligation_id`), satisfying US-36b scenario 2's "each payout's documentation is correctly itemized and attributable to its own obligation" without any cross-obligation aggregation this epic would otherwise have to invent a period-closing rule for.

Other jurisdictions, more specific Brazilian document types (e.g., a formal DARF-equivalent or an NFS-e-style note), and any timing beyond "on settlement" are explicitly **not** resolved by this decision -- they remain open, per PRD open question 6's own framing, for product to specify before any work beyond this pilot's simple PDF is built.

## Consequences

**What Aurora gains:**
- FR-50's Should-priority obligation is met with the smallest schema this epic's other decisions already make almost free: `tax_document` reuses the exact object-storage/signed-URL mechanism ADR-0042 already builds for payment statements, and its trigger (settlement) is a state transition this epic's own `payout_obligation` state machine already produces.
- The `blocked_missing_info` state turns a potentially silent gap (a creator who never provided a tax identifier simply never gets a document, with no record of why) into an explicit, visible one, satisfying US-36b scenario 3 without this epic inventing a validation or onboarding flow for the `tax_id` field itself (left to whichever epic eventually owns creator profile completeness in full).
- Because the document is generated per obligation, not per period, there is no closing-the-books logic, no handling for a late-arriving obligation after a period's documents were already generated, and no ambiguity about which document a correction would touch -- each document's scope is exactly one settled payout, permanently.

**What Aurora gives up:**
- A creator who needs a single, period-level summary document (e.g., an annual total across every payout) does not get one from this design -- only per-payout documents exist. This is a real limitation relative to what a creator's actual accountant might eventually ask for, left as a gap rather than solved speculatively.
- No jurisdiction beyond Brazil is served at all; if Aurora ever operates for a creator outside Brazil, this epic's tax-document generation simply does not apply to them, and a future epic would need to add jurisdiction-aware branching this design does not anticipate structurally (there is no `jurisdiction` field on `tax_document` to extend -- adding one later is a migration, not a configuration change).

**Risk:** The simple, single-document-type approach may not actually satisfy whatever Brazilian creators' real tax-filing needs turn out to be once the pilot runs with real creators and real tax questions -- this document's "keep simple" instruction is a scoping choice for a Should-priority story, not a claim that the resulting document is sufficient for a creator's actual accounting obligations. Mitigation: none built into this design beyond the explicit `blocked_missing_info` visibility; this is recorded as an open item for product to revisit once real creator feedback exists, consistent with FR-50's own Should priority.
