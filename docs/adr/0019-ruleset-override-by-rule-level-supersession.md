# ADR-0019: Campaign Ruleset Overrides Work by Rule-Level Supersession, Not Whole-Ruleset Replacement or Field Merge

**Status:** Proposed
**Date:** 2026-10-20
**Epic:** E4 -- Brand Safety
**Governs:** US-15, FR-31, NFR-29

## Context

FR-31 says a campaign's safety ruleset is "overridable" but does not say how. PRD open question 1 (`docs/epics/e4-brand-safety/stories.md`) states the gap plainly: "the PRD does not say whether a campaign override replaces the brand default wholesale, or merges with it rule by rule (and if it merges, which rule wins on a direct conflict)." The stories document's acceptance criteria *assume* "a full override of the specific rule in conflict" for the purposes of writing testable scenarios, but explicitly flags that assumption as needing a real decision rather than being carried into the build unexamined.

**This ADR makes that decision as an architectural one, filling a gap the product requirements leave open, because backend-dev cannot build a ruleset-override endpoint without some concrete semantics to implement.** It is not a substitute for a product decision; it is the default this epic ships with, and it is written so that revisiting it later costs a config/behavior change, not a schema migration, if product decides differently.

Three options were considered:

- **Whole-ruleset replacement.** A campaign override replaces the entire brand ruleset with a new, independent set of rules for that campaign. Simple to implement and explain, but it defeats the actual use case in US-15 scenario 2 (a co-branded campaign where one usual "competitor" is actually the partner): Marina would have to re-enter every prohibited topic and restricted-language rule she already defined at the brand level, just to change one competitor-mention rule. It also silently drops brand rules she never meant to touch if she forgets one, which contradicts US-15 scenario 1's promise that brand defaults apply "with no extra step required per campaign" -- an override that requires re-specifying everything is not really an override of one thing.
- **Field-by-field merge with last-write-wins on conflict.** The campaign's rule set and the brand's rule set are merged automatically, with some precedence rule (e.g., "campaign always wins") resolving any rule that looks like it addresses the same topic. This requires defining what "the same topic" means across two independently authored rules (is a campaign's `restricted_language` rule about "cura garantida" the same conceptual rule as a brand rule about "resultado garantido"? text similarity is not a reliable enough signal to decide this automatically), and it produces override behavior Marina did not explicitly ask for -- a rule could get silently suppressed by a same-topic campaign rule she added for an unrelated reason.
- **Rule-level supersession by explicit reference.** A campaign-scope rule either adds a new rule with no brand counterpart, or explicitly names the one brand rule it replaces or suppresses, by ID. There is never any ambiguity about what a campaign rule does to the brand ruleset, because the relationship is a reference Marina (or the system, from her explicit action) created, not an inference the system drew from rule content.

## Decision

Overrides work by **explicit, per-rule supersession**, implemented as the `action` and `supersedes_rule_id` fields on `safety_rule` (section 2.2 of the E4 architecture document):

- A campaign-scope rule with `action = 'add'` and `supersedes_rule_id = null` is a pure addition: it applies only to this campaign, in addition to every unmodified brand rule.
- A campaign-scope rule with `action = 'replace'` and `supersedes_rule_id` set names the exact brand rule it replaces for this campaign; that brand rule's own row, and its application to every other campaign, is untouched.
- A campaign-scope rule with `action = 'suppress'` and `supersedes_rule_id` set turns that one brand rule off for this campaign, with no replacement definition needed -- the direct mechanism for US-15 scenario 2's "a usual competitor is actually the partner" case.

A campaign's **effective ruleset** (what a safety check actually evaluates) is computed as: every brand rule *except* those named by a `replace`/`suppress` override on this campaign, plus every campaign-scope rule. There is no merge logic beyond this set subtraction and union -- no two rules are ever compared by content to decide a winner, because the only rules that interact are the ones a human explicitly linked by ID.

## Consequences

**What Aurora gains:**
- Zero ambiguity about what an override does. A rule either names what it supersedes or it does not touch anything -- there is no silent-conflict case for backend-dev or Marina to reason about.
- The brand default and every other campaign remain provably untouched by any one campaign's override (US-15 scenario 2's explicit requirement), because the brand rule's row is never written to by a campaign-scope action -- it is only read and conditionally excluded from one campaign's effective set.
- The campaign ruleset view (section 3.2, `GET /campaigns/:id/safety-ruleset`) can state plainly which rules are overridden and how, because that information is a direct field on the data (`source`, `override_action`), not a derived guess.
- Reverting an override is simply deleting the campaign-scope rule row -- the brand rule reappears in the effective set automatically, with no separate "restore default" action needed.

**What Aurora gives up:**
- Marina must explicitly pick which brand rule she is overriding (by selecting it in the UI, which the frontend resolves to `supersedes_rule_id`) rather than the system guessing her intent from a freeform edit. This is a small amount of extra friction in exchange for an override mechanism with no hidden behavior.
- If product later decides overrides should instead work by whole-ruleset replacement or automatic topic-matching merge, this is a behavior change inside the `brand-safety` module's rule-resolution logic, not a schema migration -- `supersedes_rule_id` and `action` can be left unused by a future design, or a migration can backfill them from a changed authoring flow. The cost of being wrong here is a code change, which is the point of making this decision explicit and isolated rather than embedding it implicitly in how every endpoint happens to behave.

**Risk:** This is a product-facing behavior decided by architecture in the product's silence. It must be surfaced to product and Marina-facing documentation before launch as "how overrides work," not left to be discovered by a confused brand manager the first time she overrides a rule and the rest of her ruleset stays intact (which is the correct behavior, but only if she expects it).
