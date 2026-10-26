# ADR-0025: Draft Version Lineage via Self-Referencing Columns on `content_submission`

**Status:** Proposed
**Date:** 2026-10-21
**Epic:** E5 -- Briefing and Content Workflow
**Governs:** US-32a, FR-39

## Context

ADR-0020 (E4) defined a minimal `content_submission` entity and named, explicitly, the one seam it deliberately left unresolved: "resubmitting content after a `revision_requested` decision creates a *new* `content_submission` row with no link back to the one it supersedes... E5 will need to decide how its version history relates to the `content_submission` rows this epic already created." PRD open question 3 restates the same gap at the product level and adds that the PRD does not specify "whether a resubmitted draft should be linked to the version it supersedes for display purposes."

FR-39 requires every submitted version to be retained, and US-32a scenario 2 requires that "what changed between versions remains visible to Marina, Duda, and an auditor alike." Two structural options were considered:

- **A separate `content_draft` parent entity**, with `content_submission` rows hanging off it as children (one `content_draft` per opportunity, many `content_submission` versions underneath). This models the "one draft, many versions" relationship with a dedicated table, which is the more conventional versioning pattern (an aggregate root plus child versions). It requires a new table and a new foreign key on every existing E4 code path that creates or reads `content_submission`, since every row would now need a `content_draft_id` to exist at all -- a more invasive change than ADR-0020's framing ("E5 extending it... is additive, not a redesign") anticipated.
- **A self-referencing lineage directly on `content_submission`**: `supersedes_submission_id` (points to the version this one replaces), `root_submission_id` (denormalized, points to the first version in the chain, equal to its own id for that first version), and `version_number`. No new table; every existing column, index, and RLS policy on `content_submission` is untouched.

## Decision

E5 extends `content_submission` with three additive, nullable-or-defaulted columns (section 3.6 of the E5 architecture document): `supersedes_submission_id` (self-referencing FK, nullable), `root_submission_id` (nullable, denormalized), and `version_number` (default 1). A submission's lineage is retrieved with `WHERE root_submission_id = :rootId ORDER BY version_number`, with no recursive query needed.

A resubmission against an opportunity is accepted only when the latest existing version in that lineage carries a `content_review_decision` of `rejected` or `revision_requested` (section 3.3 of the architecture document); it is refused if the latest version is still pending (`PENDING_REVIEW_IN_PROGRESS`) or already `approved` (`ALREADY_APPROVED`). This gives every actor a single, unambiguous "current version" per opportunity (the highest `version_number` in the lineage) at all times, while every prior version remains a separate, untouched row.

## Consequences

**What Aurora gains:**
- No new table, no new join most queries need to perform, and no change to any existing E4 code path that creates or reads a `content_submission` row without the new fields (they default to a single-version shape: `version_number = 1`, the rest null).
- "Show me every version of this draft, in order" is one indexed, non-recursive query, which is what US-32a scenario 2 and US-33 scenario 2 both need for their "which version does this reason apply to" guarantees.
- The resubmission precondition (section 3.3) makes "the current version" a computable fact (`MAX(version_number)` within a lineage) rather than a status flag that could drift out of sync with the actual rows.

**What Aurora gives up:**
- The lineage is a chain, not a tree -- a submission supersedes at most one prior version and is superseded by at most one next version. If a future product decision wants to allow, say, two creators collaborating on parallel draft branches for one opportunity, this shape would need to change. Nothing in FR-39 or the stories document suggests that need exists.
- `root_submission_id` is denormalized (copied forward on every insert) rather than derived by a recursive query at read time. A future bulk-correction of a lineage (which should never be necessary under normal operation, since every row is append-only) would need to update every row's `root_submission_id`, not just one.
- No cap on the number of versions in a lineage is enforced, and no behavior is defined for a campaign's own deadline passing while a review loop is still open -- both are left exactly as open as PRD open question 3 leaves them; this ADR resolves the *shape* of versioning, not the *product policy* questions the PRD itself declines to answer.

**Risk:** If product later decides a resubmission cap or a different linking display (e.g., "version 2 of 3" with awareness of a total count fixed in advance) is needed, this shape absorbs it as an additional application-layer rule over the same columns, not a schema change -- the risk here is low precisely because the shape chosen is the minimum structure that supports every reading of the stories document's open question, not a guess at a specific product policy.
