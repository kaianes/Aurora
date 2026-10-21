# ADR-0054: Unclaimed-Profile Recruitment Is Ops-Mediated; the Public-Data Import Snapshot Is Kept Structurally Separate From Live Creator Fields

**Status:** Proposed
**Date:** 2026-10-21
**Epic:** E8 -- Creator Recruitment and Growth
**Governs:** US-23.1, FR-12, NFR-20

## Context

FR-12 requires Aurora to "allow an unclaimed creator profile to be created from publicly available data." The PRD does not specify a discovery mechanism (a scraper, a manual research process, a third-party data broker), and `docs/architecture.md` section 2.2 already names "Aurora operations" as a fourth actor distinct from Marina, Duda, and Renata, "the staff who run active recruitment (US-23) and human safety review (US-17). These are processes the system supports, not features it automates away" -- a deliberate, already-made architectural statement that recruitment is a human-run process, not an automated pipeline, at this stage. ADR-0013 (E3) already seeded creator rows manually, outside any epic's API surface, as an explicit pilot-scope stand-in for this not-yet-built capability.

A second question, independent of who triggers creation, is how the imported data and Duda's later corrections (US-23.2 scenario 2) relate to each other in the data model. The acceptance criteria are explicit and strict: "her corrections are saved as the authoritative values (not merged with or overwritten by the original imported data)" -- a requirement that only makes sense if there are, at some point, two distinct representations of the same fields (what was imported, and what she says is actually true) and a clear rule for which one wins and what happens to the other.

Options considered for who/what creates an unclaimed profile:

- **An automated discovery pipeline** (e.g., a scraper that finds public profiles matching some criteria and creates rows unattended). Rejected for this pilot: `docs/architecture.md` already frames this as a staffed process, not an automated one, and an unattended discovery pipeline raises exactly the identity-ambiguity risk the stories document's own open question 3 flags (two people with similar public presences) with no human in the loop to catch it before Aurora starts holding data about the wrong person.
- **An ops-triggered endpoint**, requiring a human (an `aurora_operator`) to explicitly submit what they observed, one profile at a time.

Options considered for the import/correction relationship:

- **Store imported fields directly on `creator`'s own live columns, overwritten in place when corrected.** Rejected: this makes "not merged with or overwritten by the original imported data" impossible to audit after the fact -- once a correction overwrites a live column, there is no record of what was originally imported to compare against, undermining both the "not merged" guarantee (nothing to verify it against) and any future need to demonstrate to a regulator or to Duda herself exactly what Aurora held about her before she corrected it.
- **A separate, immutable import snapshot table**, with `creator`'s own live columns being the single, current, authoritative source of truth from the moment of either import (pre-claim) or correction (post-claim) -- never a merge of the two.

## Decision

`POST /ops/creators/unclaimed` (E8 architecture doc section 4.1) is the only way an unclaimed profile is created in this pilot, requiring the `aurora_operator` principal (reused from ADR-0038, no new guard). It creates two rows in one transaction: `creator` (with every metric field this epic's qualification pipeline would otherwise populate left `null`, per US-23.1 scenario 2's explicit "leaves the fields it cannot verify null rather than estimating") and `creator_public_import`, an immutable (trigger-enforced, no `UPDATE` permitted) snapshot of exactly what the operator reported observing. Before Duda ever claims the profile, `creator`'s live `display_name`/`content_niche` fields are populated directly from the import at creation time (there is nothing to distinguish yet, since no correction has happened); the import row exists from the start specifically so that the moment a correction does happen (section 3.2 of the architecture doc, claim confirmation), there is an unambiguous "before" state to diff against and retain, even though the "after" state simply becomes the new live value with no merge logic required at the point of correction itself -- the separation does its work by existing, not by any runtime reconciliation code.

No automated discovery mechanism is built or implied by this decision. The stories document's own open question 3 (identity ambiguity across two people with similar public presences) is **not** resolved by this ADR -- it is explicitly left to product, consistent with the task's own instruction to leave genuinely product-level questions open. This decision does make that future resolution cheaper to build: `creator_public_import.imported_by_user_id` and `raw_payload` already exist specifically so a future mandatory disambiguation step (e.g., a second operator's confirmation, or a required minimum set of corroborating public signals) has an audit trail to attach new validation to, without needing new columns.

## Consequences

**What Aurora gains:**
- Recruitment risk (the identity-ambiguity concern, the "did we hold data we shouldn't have" concern) is bounded by a human decision point at creation time, consistent with how `docs/architecture.md` already frames this entire process and consistent with ADR-0038's own precedent of deliberately not over-building governance around a manually-granted, high-trust internal operation before product specifies more.
- The import/correction separation makes US-23.2 scenario 2's "not merged" guarantee a structural fact (there is no code path that merges the two tables' values) rather than a service-layer discipline someone could accidentally violate in a future change.
- Both NFR-20's "public data only" and the eventual claim-time correction behavior are independently and mechanically verifiable: a reviewer can inspect `creator_public_import` and see literally nothing but what was reported observed, with no inferred field anywhere in that table's schema to tempt a future implementer into filling one in "just this once."

**What Aurora gives up:**
- Recruiting at any real scale is bottlenecked by however many profiles an `aurora_operator` can manually submit, one `POST` at a time -- this pilot makes no attempt to automate discovery, which the stories document's own open question 8 (no measurable NFR for creator acquisition cost or recruitment-funnel efficiency) already flags as a business-level gap this architecture does not attempt to close. A future automated discovery pipeline, if product decides to build one, would feed this same endpoint rather than bypass it, but that pipeline is not designed here.
- A profile's import snapshot persists until claim, decline, or 90-day expiry, meaning Aurora holds a second (immutable) copy of the same handful of public facts alongside the live `creator` row for that entire window -- a modest, deliberate data-duplication cost accepted in exchange for the audit/non-merge guarantee above.

**Risk:** A single operator acting alone, with no second-reviewer requirement, could create a profile for the wrong person (the identity-ambiguity risk named in open question 3) with no system-level check to catch it before the invitation is sent to a contact email the operator herself supplied. Mitigation: this is recorded explicitly as an open product question (not silently resolved either way), and the audit fields (`imported_by_user_id`, `raw_payload`, `created_by_user_id` on the subsequent invitation) at minimum make the action attributable and reviewable after the fact, consistent with `docs/architecture.md` section 4.2's framing of the audit log as "a security control, not a debugging aid."
