# ADR-0030: A Configurable Review-Deadline Default and an Escalation Flag With No Named Target

**Status:** Proposed
**Date:** 2026-10-21
**Epic:** E5 -- Briefing and Content Workflow
**Governs:** US-32b, FR-41

## Context

FR-41 requires that "the system shall display a review deadline to the creator at submission time and escalate the review when that deadline is breached." Two things the PRD does not state, named explicitly by the stories document as open: how the deadline itself is computed (what window, from when), and who or what receives the escalation (PRD open question 2: "a specific reviewer, a supervisor, an operations queue, or simply a more prominent flag on the same reviewer's own view"). US-32b scenario 3 requires only that "at minimum, it is visibly marked overdue and escalated in a way both Duda and Marina's team can see, even where the precise notification target is not fully specified by the requirements" -- a floor, not a ceiling, on what this design must guarantee.

## Decision

**The deadline.** `review_deadline_at` is set once, at draft-submission time, to `submitted_at + DRAFT_REVIEW_SLA_HOURS`, an externally configured value (NFR-30-consistent: supplied at deploy time, not hardcoded) defaulting to 48 hours for the pilot. This default is an architectural choice filling a product gap, exactly in the spirit of ADR-0019's own precedent for the equivalent situation in E4 ("an architectural decision filling a product gap, made because backend-dev needs one concrete rule to build against; it is not a substitute for product confirming the behavior later") -- 48 hours is not derived from any stated requirement, it is a plausible pilot value, explicitly open to revision without a migration (it is a config value, not a hardcoded constant, and it governs only *future* submissions -- an already-set `review_deadline_at` on an existing row is never recomputed retroactively if the config changes).

**The escalation.** A cron job (`escalate-overdue-draft-reviews`, section 5 of the E5 architecture document) runs every 15 minutes, finds every `content_submission` whose `review_deadline_at` has passed with no `content_review_decision` row yet and `review_escalated` still `false`, and sets `review_escalated = true`, `review_escalated_at = now()`. This flag is read by both Duda's own submission view (US-32b scenario 2's "Duda's own view of her submission reflects that it has been escalated") and Marina's review-queue listing, satisfying US-32b scenario 3's floor exactly: "visibly marked overdue and escalated... both Duda and Marina's team can see." No notification is sent to any specific person, role, or queue beyond this -- no escalation *target* is invented.

## Consequences

**What Aurora gains:**
- FR-41's obligation holds mechanically: a breached deadline is never silently indistinguishable from one still on track, regardless of whether product ever specifies a notification target. The flag exists and is visible on both sides the moment the sweeper runs, independent of any future decision about who additionally gets told.
- The deadline window is a one-line config change, not a schema or code change, if 48 hours proves wrong in either direction during the pilot -- exactly the kind of tuning NFR-30 exists to make cheap.
- A 15-minute sweep cadence keeps the escalation flag's own staleness bounded tightly relative to the multi-hour deadline window it watches, without the cost of checking on every read (the alternative -- computing "is this overdue" live, on every GET, rather than via a sweeper -- would avoid a cron job entirely but would also mean the *flag itself* could never be durably `true` for anything reading it outside that one request, which would break the "visibly marked" requirement's implication that the mark persists).

**What Aurora gives up:**
- No specific person is ever told a review is overdue beyond what appears in the two views named above -- if product later wants, say, an email to a supervisor or a dedicated operations queue, that is new work on top of this flag (a notification hook reading `content_submission.review_escalated` transitions), not a redesign of it.
- 48 hours is a guess, not a measured value. If it is badly miscalibrated (too short, triggering escalations on reviews that were always going to take longer; too long, leaving Duda waiting well past a reasonable expectation before anything visibly changes), the pilot will surface that through the same escalation-rate signal NFR-31/NFR-32's production-measurability commitment already calls for instrumenting.

**Risk:** The 48-hour default is unvalidated against real reviewer behavior, the same category of risk `docs/architecture.md`'s R-01 already names for E4's escalation-rate assumption. Mitigation: treat `review_escalated` as a monitored rate from the first live campaign onward, and revisit the default once real data exists, exactly as R-01's own mitigation pattern prescribes.
