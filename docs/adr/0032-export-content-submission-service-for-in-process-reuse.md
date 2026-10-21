# ADR-0032: Extending and Exporting `ContentSubmissionService` for Direct In-Process Reuse by `content-workflow`

**Status:** Proposed
**Date:** 2026-10-21
**Epic:** E5 -- Briefing and Content Workflow
**Governs:** US-32a, FR-39

## Context

ADR-0020 stated, in advance, exactly how E5 should populate `content_submission` once it ships: "directly, or via `brand-safety`'s exported service, not HTTP, since both modules live in the same deployable." At the time ADR-0020 was written, `brand-safety.module.ts` exported only `BrandSafetyGateService`; `ContentSubmissionService` (which owns the actual row-creation and safety-check-kickoff logic, section 3.3 of the E4 architecture document) was not exported, because nothing outside `brand-safety` needed it yet.

Now that E5 exists, `content-workflow`'s own draft-intake endpoint needs to do exactly what `ContentSubmissionService.createSubmission` already does -- validate the opportunity, create the `content_submission` row, resolve the effective ruleset, create the `safety_check` row, and enqueue the appropriate job (`extract-content-channels` or `run-safety-check`) -- plus a few fields `createSubmission` does not yet know about (the version-lineage columns and the review deadline, both owned by this epic, ADR-0025 and ADR-0030). Two options were considered:

- **Duplicate the logic.** `content-workflow` gets its own repository access to `content_submission` and `safety_check`, its own call into `RulesetService.resolveGoverningRulesetId` (which would also need exporting), and its own enqueue calls onto the `brand-safety` Bull queue (which any module can already inject by name, since Bull queues are not access-controlled by module boundary). This keeps `brand-safety`'s own exports list smaller but means two code paths exist that can create a `content_submission` row and kick off a safety check, with every future change to that sequence (e.g., a new required validation, a change to how the ruleset snapshot is resolved) needing to be made twice or risk drifting apart.
- **Extend `createSubmission` additively and export the service**, so there remains exactly one code path that creates a `content_submission` row and starts its safety check, now parameterized with the two new, optional fields this epic needs.

## Decision

`ContentSubmissionService.createSubmission`'s accepted input is extended with two optional fields -- `supersedesSubmissionId` and `reviewDeadlineAt` -- written into the same atomic insert that already creates the `content_submission` row (computing `version_number` and `root_submission_id` from `supersedesSubmissionId` when present, defaulting to a first-version shape when absent, preserving E4's own stub behavior exactly for any caller that does not pass the new fields). `brand-safety.module.ts`'s `exports` array grows from `[BrandSafetyGateService]` to `[BrandSafetyGateService, ContentSubmissionService]`. `content-workflow` imports `BrandSafetyModule` and calls `ContentSubmissionService.createSubmission` directly, in process, for its own draft-intake endpoint (section 4.4 of the E5 architecture document), after first validating the opportunity, campaign state, and resubmission precondition that are specific to E5's own obligations and do not belong inside `brand-safety`'s service.

`ContentSubmissionIntakeController` (E4's HTTP stub) and its route are retired, superseded by `content-workflow`'s own controller at the same path, exactly as ADR-0020 forecast and explicitly authorized in advance ("the stub endpoint could calcify into a de facto production path... this ADR and the architecture document both state explicitly that `BrandSafetyGateService`'s two methods, not this HTTP endpoint, are the contract a future E5 architecture should build against").

## Consequences

**What Aurora gains:**
- Exactly one code path creates a `content_submission` row and starts its safety check, regardless of which module's endpoint triggered it. A future change to that sequence (a new validation, a different ruleset-resolution rule, a new required field on the row) is made once, in `ContentSubmissionService`, and both E4's own internal usage and E5's draft intake pick it up automatically.
- The extension is additive and default-preserving: any existing caller that does not pass `supersedesSubmissionId`/`reviewDeadlineAt` gets exactly E4's original behavior, so nothing about E4's own tests or its own (now-retired) stub endpoint's prior behavior needs to change to accommodate this.
- This ADR executes a decision ADR-0020 already made, rather than introducing a new one -- the risk of two epics disagreeing about how their boundary should work is close to zero, since E4's own architecture document named this exact mechanism as the expected path before E5 was ever designed.

**What Aurora gives up:**
- `brand-safety`'s exports surface grows from one service to two, which is a small widening of the "narrow interface, not a provider SDK" discipline NFR-29 otherwise enforces strictly for this module (section 3.6 of the E4 architecture document: "Neither `campaign` nor any future payment module may import `safety_check`, `safety_rule`, or `safety_review_queue_item` directly"). This is a deliberate, bounded exception: `ContentSubmissionService` exposes only its submission-creation method, not the underlying entities, and `content-workflow` still cannot reach `safety_check`, `safety_rule`, or `safety_review_queue_item` directly -- the widening is one additional service method, not a door into the judgment-logic tables NFR-29 exists to protect.
- `content-workflow` now has a compile-time dependency on `brand-safety`'s module (via `BrandSafetyModule`'s export), in addition to the existing dependency on `BrandSafetyGateService`. This is an acceptable, one-directional coupling (`content-workflow` depends on `brand-safety`; `brand-safety` depends on nothing from `content-workflow`), consistent with the build order the platform already has (E4 shipped before E5) and with every other "a later epic extends an earlier epic's minimal entity" precedent (ADR-0013, ADR-0020 itself).

**Risk:** None beyond the general risk any exported service carries of being called in a way its original author did not anticipate. The optional-parameter extension is designed specifically to bound that risk: existing call sites are unaffected by construction, since the new parameters default to behavior identical to before this epic existed.
