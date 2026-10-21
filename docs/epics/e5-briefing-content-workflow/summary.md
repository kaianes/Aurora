# Epic E5, Briefing and Content Workflow: Summary

**Author:** Kaiane Cordeiro. Aurora Project, Sprint 7. **Date:** October 21, 2026.

> **TL;DR.** All 8 Must stories (US-18a, US-18b, US-30, US-32a, US-32b, US-19, US-33, US-34) and the 1 Should story (US-31) implemented, tested, and pending merge. Backend: 247/247 tests passing. Frontend: 75/75 passing. Both totals independently re-run by this review and matched QA's reported figures exactly. New `content-workflow` module built on top of E4's `content_submission` entity exactly as ADR-0020 forecast: E4's stub `ContentSubmissionIntakeController` is retired, `ContentSubmissionService` is additionally exported from `brand-safety.module.ts` (ADR-0032), and `content_submission` gains eight additive, nullable-or-defaulted columns via a migration that touches no existing column (ADR-0025). Publication confirmation (US-34) checks two independent gates in sequence, each with its own error code, exactly as ADR-0027 specifies, and calls `BrandSafetyGateService.getGateStatus`/`recordPublication` without reimplementing either. QA found zero implementation bugs and added targeted coverage for multi-hop version lineage, escalation-is-visibility-only, and Marina/Duda shared-decision-record consistency; this review independently located and read all three tests and confirms they exercise what QA claims. No deviation from any ADR or from the architecture document's endpoint/data-model shapes was found in this review. Several PRD open questions remain explicitly unresolved, by design, consistent with the stories document's own framing.

## 1. Purpose

This document summarizes what was built for Epic E5 (Briefing and Content Workflow), checks it against the eight E5 ADRs (0025 through 0032) and the E5 architecture specification, reports the actual state of automated tests, and lists open items. It is the gate artifact reviewed before merging `feature/e5-briefing-content-workflow` into `main`. E5 branches from `main` (which already contains E1 through E4), so this review's diff (`git diff main...feature/e5-briefing-content-workflow`) covers only E5's own changes, including its one additive touch to E4's `brand-safety` module.

<p align="center"><strong>Table 1</strong></p>

<p align="center"><em>Stories in Scope for Epic E5</em></p>

<div align="center">

| Story | Priority | Persona | Status |
|---|---|---|---|
| US-18a Compose a Structured Briefing | Must | Marina | Implemented, tested |
| US-18b Distribute a Briefing to the Entire Pool in One Action | Must | Marina | Implemented, tested |
| US-30 Receive a Briefing with Explicit Do's, Don'ts, and Examples | Must | Duda | Implemented, tested |
| US-31 Ask a Question About the Briefing and Get an Answer | Should | Duda | Implemented, tested |
| US-32a Submit a Content Draft with Version Retention | Must | Duda | Implemented, tested |
| US-32b See the Review Deadline and Have It Escalate on Breach | Must | Duda | Implemented, tested |
| US-19 Approve or Reject a Draft with a Stated Reason | Must | Marina | Implemented, tested |
| US-33 Receive a Stated Reason Whenever Content Is Rejected | Must | Duda | Implemented, tested |
| US-34 Confirm Publication by Submitting the Live Post Link | Must | Duda | Implemented, tested |

</div>

*Note.* Priority follows the MoSCoW scale defined in the product requirements document, confirmed directly against `docs/epics/e5-briefing-content-workflow/stories.md` rather than assumed. US-18a/US-18b and US-32a/US-32b are each sub-stories of a single parent story (US-18, US-32), tracked separately here because each sub-story carries its own acceptance criteria and, for US-32a/US-32b, its own governing ADR.

## 2. What Was Built

**Backend** (`backend/src/content-workflow`): one new NestJS module, `content-workflow`, covering all nine stories. `briefing.service.ts`/`briefing.controller.ts` implement US-18a/US-18b: lazy-created draft briefings, partial-update `PUT` semantics, the five-field completeness check on `issue`, and the synchronous recipient-snapshot write (every creator holding a `campaign_opportunity` for the campaign at the moment of issuing, regardless of that opportunity's own status) followed by an asynchronous `distribute-briefing` job. `briefing-qa.service.ts`/`briefing-qa.controller.ts`/`creator-portal-briefing.controller.ts` implement US-30/US-31: the live, read-time view-access gate against `campaign_opportunity.status` (never the distribution snapshot), one lazily created thread per `(briefing_id, creator_id)` pair, and a computed-at-read-time `answered` flag. `draft-submission.service.ts` implements US-32a/US-32b and the read side of US-33: the resubmission precondition (`PENDING_REVIEW_IN_PROGRESS` / `ALREADY_APPROVED`), the lineage list ordered by `version_number`, and the `review_deadline_at`/`review_escalated` fields surfaced alongside a live `BrandSafetyGateService.getGateStatus` read on every version. `review-decision.service.ts`/`content-submission-decision.controller.ts` implement US-19/US-33's write side: the `content_review_decision` row, the stated-reason enforcement, and the explicit absence of any call into `BrandSafetyGateService`. `publication.service.ts` implements US-34: the two-gate check (`content_review_decision` then `BrandSafetyGateService.getGateStatus`), the dedicated `PublicationLinkVerifierAdapter` call, and the `recordPublication` completion hook. `content-workflow-scheduled-tasks.service.ts` runs the `escalate-overdue-draft-reviews` cron every 15 minutes. `distribute-briefing.processor.ts` runs the asynchronous fan-out behind `BriefingNotificationAdapter`. One migration (`1715000000000-ContentWorkflowSchema.ts`) creates the five new tables, their check constraints, and RLS policies, and adds eight additive columns to `content_submission`.

The one change to E4's own module: `backend/src/brand-safety/brand-safety.module.ts` retires `ContentSubmissionIntakeController` (deleted outright, not merely unrouted) and widens its `exports` array from `[BrandSafetyGateService]` to `[BrandSafetyGateService, ContentSubmissionService]`. `content-submission.service.ts`'s `createSubmission` gains an optional `CreateSubmissionOptions` parameter (`supersedesSubmissionId`, `reviewDeadlineAt`), computing `version_number`/`root_submission_id` when a prior version is named and defaulting to E4's original first-version shape when it is not.

**Frontend** (`frontend/src`): implements the route map from architecture section 6: `/app/campaigns/:id/briefing` (composer, WCAG 2.2 AA), `/app/campaigns/:id/briefing/distribution` (delivery outcome), `/app/campaigns/:id/briefing/qa` (thread list and answer composer), `/app/campaigns/:id/content-submissions` (Marina's review queue, per-lineage grouping with a latest-version default), `/creator-portal/briefing` (viewer, WCAG 2.2 AA), `/creator-portal/briefing/qa` (ask/view thread), `/creator-portal/drafts/new` (replacing E4's gap-filler form), `/creator-portal/drafts` (version history), and `/creator-portal/drafts/:id/confirm-publication` (publication form surfacing `PUBLICATION_LINK_UNREACHABLE`/`PUBLICATION_CONTENT_MISMATCH`/`SAFETY_NOT_CLEARED` as distinct states). E4's `new-submission-page.tsx` is renamed and rebuilt into `new-draft-page.tsx` at the new route. Campaign-detail and creator-opportunity pages gained navigation links into all of the above.

**QA round.** QA reported PASS on all nine stories, 247/247 backend tests and 75/75 frontend tests, with zero implementation bugs found. QA added test coverage for three specific claims: multi-hop version lineage, escalation-is-visibility-only, and Marina/Duda shared-decision-record consistency. This review independently located and read all three:

1. **Multi-hop version lineage** (`backend/src/brand-safety/content-submission.service.spec.ts`, "carries root_submission_id forward unchanged across three chained resubmissions"): chains three resubmissions (v1 to v2 to v3) and asserts v3's `root_submission_id` still equals v1's id, not v2's, and that `supersedes_submission_id` points one hop back. Confirmed to genuinely exercise ADR-0025's denormalization claim across more than one hop, not just the one-hop case the main service tests already cover.
2. **Escalation-is-visibility-only** (`backend/src/content-workflow/draft-submission.service.spec.ts`, "still refuses resubmission with PENDING_REVIEW_IN_PROGRESS even when the pending version has been escalated"; `content-workflow-scheduled-tasks.service.spec.ts`, "never creates or otherwise touches a content_review_decision row"): both tests directly probe ADR-0030's claim that `review_escalated` is a terminal flag that "does not block anything" and never implicitly advances the decision state machine. Confirmed accurate.
3. **Marina/Duda shared-decision-record consistency** (`content-review-decision-consistency.spec.ts`, new file, root of `content-workflow`): wires `ReviewDecisionService` (write side) and `DraftSubmissionService` (read side) against the same in-memory repository instance and asserts Duda's view surfaces the exact `decision`, `reason`, and `decided_at` Marina's call just wrote, with no intermediate transformation, plus a negative case confirming a reasonless rejection attempt leaves Duda's view still `pending`. Confirmed to be a genuine cross-service consistency test, not a restatement of either service's own unit tests.

## 3. Compliance With ADRs and Architecture

**ADR-0025 (Draft Version Lineage via Self-Referencing Columns):** followed exactly. `content-submission.service.ts`'s extended `createSubmission` computes `version_number` as `previous.versionNumber + 1` and carries `root_submission_id` forward from the superseded row (or self-assigns it on the first version, via a necessary second write after the insert assigns an id, exactly as a self-referencing root requires). `draft-submission.service.ts`'s resubmission check resolves the latest version by `version_number DESC` within an `opportunity_id`, matching section 3.3's precondition precisely: refuses with `PENDING_REVIEW_IN_PROGRESS` when no decision exists yet, `ALREADY_APPROVED` when the latest decision is `approved`, and accepts (setting `supersedesSubmissionId` to the latest row's id) only when the latest decision is `rejected` or `revision_requested`. The migration adds `supersedes_submission_id`, `root_submission_id`, and `version_number` as additive columns on the existing `content_submission` table, with no new table and no change to any existing column, exactly as the ADR's "what Aurora gains" section claims.

**ADR-0026 (A Dedicated `content_review_decision` Entity, Separate From E4's Safety Review Queue):** followed exactly. `content_review_decision` is a new table, unique on `content_submission_id`, reusing the identical three-way vocabulary and stated-reason rule E4's `review-queue.service.ts` already established. `review-decision.service.ts` never imports or calls `BrandSafetyGateService`, `ReviewQueueService`, or any `safety_*` repository; its one explicit code comment states this is deliberate. `BrandSafetyGateService` itself is untouched by this epic (confirmed by diffing `brand-safety-gate.service.ts` against `main`: zero lines changed), so E4's gate computation remains exactly as unaware of this epic's existence as the ADR requires.

**ADR-0027 (Publication Confirmation Requires Two Independent, Separately Computed Gates):** followed exactly. `publication.service.ts`'s `confirmPublication` checks `content_review_decision` first (`DRAFT_NOT_APPROVED` on failure), then calls `BrandSafetyGateService.getGateStatus` second (`SAFETY_NOT_CLEARED` on failure, echoing `gate.blockingReason` in `details`), as two sequential, independent reads with two distinct error codes, neither collapsed into the other. `BrandSafetyGateService.recordPublication` is called unmodified afterward; reading `brand-safety-gate.service.ts` directly confirms its own internal `getGateStatus` re-check is still present and unaltered, so this epic's own check is genuinely redundant defense-in-depth, not a replacement, exactly as the ADR frames it.

**ADR-0028 (Briefing Q&A as a Per-Creator Private Thread, With No Response-Time Obligation):** followed exactly. `briefing_qa_thread` is unique on `(briefing_id, creator_id)`; every read in `briefing-qa.service.ts` filters by the requesting creator's own id (`resolveBriefingForCreatorOrFail`, `getOwnThread`), so there is no code path that can return another creator's thread. `computeAnswered` derives the `answered` state from the last message's `sender_type` at read time, with no stored boolean, matching the ADR's explicit "a fact derivable from existing rows should be derived, not cached" principle. No SLA, deadline, or escalation mechanism exists anywhere in this service, consistent with the ADR's deliberate asymmetry with ADR-0030.

**ADR-0029 (Briefing Distribution Is a Point-in-Time Snapshot, Decoupled From Live View-Access Gating):** followed exactly. `briefing.service.ts`'s `issueBriefing` resolves recipients from every `campaign_opportunity` row for the campaign "at this moment," regardless of status, and writes one `briefing_distribution_recipient` row per recipient, immutable thereafter except for the `delivered`/`failed` status the background job resolves. `briefing-qa.service.ts`'s `resolveBriefingForCreatorOrFail` (used by both the briefing GET and the Q&A endpoints) is a wholly separate, live query against `campaign_opportunity.status = accepted`, never touching `briefing_distribution_recipient` at all. These are structurally two independent queries against two independent tables, exactly as the ADR specifies; the `campaign_opportunity` table's own `uq_opportunity (campaign_id, creator_id)` constraint (from E3's migration) guarantees the per-creator recipient-snapshot insert can never collide with the new table's own `uq_distribution_recipient (briefing_id, creator_id)` constraint, since a creator can hold at most one opportunity row per campaign.

**ADR-0030 (A Configurable Review-Deadline Default and an Escalation Flag With No Named Target):** followed exactly. `DRAFT_REVIEW_SLA_HOURS` is read from `process.env.DRAFT_REVIEW_SLA_HOURS`, defaulting to 48, exactly as the ADR specifies, and is computed once at submission time (`draft-submission.service.ts`) rather than re-evaluated later. `escalate-overdue-draft-reviews` runs on a `*/15 * * * *` cron, finds `review_deadline_at < now()` with `review_escalated = false` and no `content_review_decision` row, and sets `review_escalated = true`/`review_escalated_at = now()` exactly once, writing `content_submission.review_escalated` to an audit log entry. No escalation target beyond the flag itself is invented anywhere in the code, matching the ADR's explicit scope limit.

**ADR-0031 (Publication Link Verification Behind a Dedicated Adapter, Independent of E4's Monitoring Fetcher):** followed exactly. `publication-link-verifier.adapter.ts` defines `PublicationLinkVerifierAdapter` with the exact three-branch return type (`resolved: true, matches: true` / `resolved: true, matches: false, fetchedCaptionText` / `resolved: false`) the ADR specifies, bound behind the `PUBLICATION_LINK_VERIFIER_ADAPTER` DI token, with no import of or reference to `LiveContentFetcher` anywhere in `content-workflow`. `StubPublicationLinkVerifierAdapter` unconditionally returns `resolved: true, matches: true`, matching the documented pilot/demo default. `publication.service.ts` compares caption text only (`approvedCaptionText: submission.captionText`), consistent with the ADR's explicit scope limit to caption-only comparison.

**ADR-0032 (Extending and Exporting `ContentSubmissionService` for Direct In-Process Reuse by `content-workflow`):** followed exactly, and independently re-verified by this review rather than taken on QA's word. Three specific checks:
1. `content-submission-intake.controller.ts` no longer exists on the E5 branch, and `brand-safety.module.ts`'s `controllers` array no longer references it.
2. `brand-safety.module.ts`'s `exports` array is `[BrandSafetyGateService, ContentSubmissionService]`, confirmed by direct diff; the module's own code comment states the widening is deliberate and bounded, matching the ADR's "one additional service method, not a door into the judgment-logic tables" framing.
3. `ContentSubmissionService.createSubmission`'s new `CreateSubmissionOptions` parameter is optional and additive; its own backend test ("defaults to a first-version shape when no options are passed") explicitly asserts backward compatibility for any caller that does not pass the new fields, confirming no existing E4 behavior changed.

**content_submission's data model (section 3.6 of the architecture document, cross-referencing ADR-0025):** confirmed via direct read of `1715000000000-ContentWorkflowSchema.ts`: all eight new columns (`supersedes_submission_id`, `root_submission_id`, `version_number`, `review_deadline_at`, `review_escalated`, `review_escalated_at`, `published_url`, `published_at`) are added with `ADD COLUMN`, each nullable or defaulted, with zero `ALTER COLUMN`/`DROP COLUMN` statements against any of E4's original fields anywhere in the `up()` method. The migration's own `down()` method drops exactly the eight added columns and nothing else, confirming the change is additive in both directions.

**US-34's two-gate independence (the specific concern this review was asked to pay particular attention to):** confirmed genuinely independent, not a single combined check or a check against only one gate. `publication.service.ts` reads `content_review_decision` via its own repository (never through `BrandSafetyGateService`) and separately calls `this.gateService.getGateStatus(submissionId)` (never duplicating the gate's own query logic); the two checks throw with two distinct HTTP error codes (`DRAFT_NOT_APPROVED` vs. `SAFETY_NOT_CLEARED`) at two distinct points in the method body, and a submission approved-but-not-cleared or cleared-but-not-approved would fail at a different, identifiable step. No shortcut exists that checks only one gate and infers the other.

No other deviations between the implementation and the eight ADRs or the architecture contract's endpoint/data-model shapes were found. One point worth naming for completeness, not as a deviation: the architecture document's response shape for `POST /creator-portal/content-submissions` (section 4.4) is produced entirely inside `ContentSubmissionService.createSubmission` (E4's own method, now extended), with `content-workflow`'s own controller and `DraftSubmissionService` adding no fields of their own to that specific response; this is consistent with ADR-0032's framing that the in-process call is the single source of that response, not a second assembly step.

## 4. Test Results

<p align="center"><strong>Table 2</strong></p>

<p align="center"><em>Automated Test Results by Package</em></p>

<div align="center">

| Package | Command | Result |
|---|---|---|
| Backend | `npx vitest run` (from `backend/`) | 40 test files, 247 tests, all passing |
| Frontend | `npx vitest run` (from `frontend/`) | 22 test files, 75 tests, all passing |

</div>

Both totals were independently re-run by this review and matched QA's reported figures exactly. Backend coverage specific to this epic includes `briefing.service.spec.ts`, `briefing-qa.service.spec.ts`, `draft-submission.service.spec.ts`, `review-decision.service.spec.ts`, `publication.service.spec.ts`, `distribute-briefing.processor.spec.ts`, `content-workflow-scheduled-tasks.service.spec.ts`, `content-workflow.config.spec.ts`, plus the extension to E4's own `content-submission.service.spec.ts` and the new cross-service `content-review-decision-consistency.spec.ts`. Frontend coverage specific to this epic includes `briefing-composer-page.spec.tsx`, `briefing-distribution-page.spec.tsx`, `briefing-qa-page.spec.tsx`, `content-submissions-page.spec.tsx`, and the creator-portal equivalents (`briefing-page.spec.tsx`, `briefing-qa-page.spec.tsx`, `new-draft-page.spec.tsx`, `drafts-page.spec.tsx`, `confirm-publication-page.spec.tsx`), replacing E4's retired `new-submission-page.spec.tsx`.

## 5. Story Coverage

<p align="center"><strong>Table 3</strong></p>

<p align="center"><em>Story Coverage Against Automated Tests and QA Results</em></p>

<div align="center">

| Story | Priority | Backend evidence | Frontend evidence | QA result | Final verdict |
|---|---|---|---|---|---|
| US-18a | Must | Partial-save `PUT`, five-field completeness check, `BRIEFING_INCOMPLETE` refusal | `briefing-composer-page.spec.tsx` | PASS | Meets acceptance criteria |
| US-18b | Must | Recipient snapshot at issue time, async fan-out, per-recipient delivered/failed reporting | `briefing-distribution-page.spec.tsx` | PASS | Meets acceptance criteria |
| US-30 | Must | Live accepted-opportunity gate, uniform `BRIEFING_NOT_AVAILABLE` across three failure cases | `briefing-page.spec.tsx` (creator) | PASS | Meets acceptance criteria |
| US-31 | Should | Per-creator private thread, read-time `answered` computation | `briefing-qa-page.spec.tsx` (both sides) | PASS | Meets acceptance criteria |
| US-32a | Must | Resubmission precondition, multi-hop lineage, `OPPORTUNITY_NOT_FOUND`/`CAMPAIGN_NOT_ACTIVE` refusals | `new-draft-page.spec.tsx`, `drafts-page.spec.tsx` | PASS | Meets acceptance criteria |
| US-32b | Must | `review_deadline_at` set once, 15-minute sweeper, escalation-is-visibility-only | `drafts-page.spec.tsx` | PASS | Meets acceptance criteria |
| US-19 | Must | Stated-reason enforcement, `ALREADY_DECIDED` guard, no safety-gate consultation | `content-submissions-page.spec.tsx` | PASS | Meets acceptance criteria |
| US-33 | Must | Reason attributed to exact version, atomic write, cross-service consistency spec | `drafts-page.spec.tsx` | PASS | Meets acceptance criteria |
| US-34 | Must | Two independent gates, dedicated link-verifier adapter, three distinct error codes | `confirm-publication-page.spec.tsx` | PASS | Meets acceptance criteria |

</div>

All nine stories in scope (eight Must, one Should) have a corresponding passing QA result; none shipped without one.

## 6. Deviations Summary

No deviation was found between the implementation and any of the eight governing ADRs, or between the implementation and the architecture document's stated endpoint and data-model shapes. The three points this review was specifically asked to verify independently (the retirement of E4's stub controller and the export of `ContentSubmissionService`, the additive-only nature of the `content_submission` migration, and US-34's two-independent-gates check) were each re-confirmed by direct inspection of the code, not taken on the architecture document's or QA's word alone; all three hold exactly as specified. The items below are disclosed gaps, not implementation deviations:

1. **Disclosed and unresolved, by design (PRD open question 1):** the briefing Q&A thread carries no response-time obligation, matching FR-38's own silence and ADR-0028's explicit design choice.
2. **Disclosed and unresolved, by design (PRD open question 2):** the review-deadline escalation names no specific notification target beyond the `review_escalated` flag itself, matching ADR-0030's explicit scope limit.
3. **Disclosed and unresolved, by design (PRD open question 3, part):** no cap exists on the number of resubmissions in a lineage, and no special handling exists for a campaign deadline passing mid-review-loop.
4. **Disclosed and unresolved, by design (PRD open question 4):** a "reference example" is validated as any non-empty string; no typed schema (link vs. upload vs. free text) is enforced.
5. **Disclosed and unresolved, by design (PRD open question 5):** the write-role set for answering Q&A and deciding a draft is an architectural default (the same role list E2 through E4 already use for brand-risk/creative-approval actions), not a confirmed product decision.
6. **Disclosed and unresolved, by design (PRD open question 6):** pausing or cancelling a campaign has no defined effect on an in-flight briefing, open Q&A thread, or pending review; `draft-submission.service.ts` only blocks a *new* submission against a non-active campaign.
7. **Disclosed and unresolved, by design (PRD open question 7):** the publication-link content-match tolerance is exact-match-after-whitespace-normalization on caption text alone, an architectural default per ADR-0031, not a confirmed product tolerance threshold.
8. **Carried over, unchanged by this epic:** `TenantContextMiddleware` remains unregistered in `AppModule`, a gap first disclosed in E1 and carried through E2, E3, and E4 unchanged; this epic's RLS policies rely on the same `app.creator_portal` escape hatch and explicit application-level `accountId`/`creatorId` filtering E3/E4 already established, and this review found that discipline consistently applied across every new service in this epic.

## 7. Open Items for the Next Epic

- Bring PRD open questions 1 through 7 (listed in Section 6) to product for a decision; none are resolved by this epic, by design, consistent with the stories document's own framing.
- Register the tenant-context middleware correctly and add an RLS-coverage test; unresolved across five epics now (E1 through E5).
- Replace both the `StubBriefingNotificationAdapter` and the `StubPublicationLinkVerifierAdapter` with real implementations (the platform's notification-provider integration, and a real live-fetch mechanism for publication links) before either flow is used for anything beyond a demo/QA path; both are explicitly named as pilot/demo defaults in their governing ADRs (ADR-0031, and section 5 of the architecture document for the notification adapter).
- When a future epic needs to decide a resubmission cap or a different version-display convention (for example, "version 2 of 3"), build it as an additional application-layer rule over the existing `supersedes_submission_id`/`root_submission_id`/`version_number` columns, per ADR-0025's own stated absorption path, rather than a schema change.
- Revisit the 48-hour review-deadline default and the 15-minute escalation-sweep cadence once real reviewer-behavior data exists from the first live campaign; both are explicitly unvalidated pilot defaults per ADR-0030's own risk framing.
- E6 (out of this epic's scope) needs to key its payout-obligation creation off `content_submission.publication_confirmed`/the `published_at` field this epic sets, exactly as US-34's own stories-document framing anticipates; no payout logic exists anywhere in this epic's code, confirmed by this review.

## References

Aurora Project Team. (2026). *ADR-0020: A minimal content_submission entity, owned by E4 only until E5 ships*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0021: Content safety judgment isolated behind a ContentSafetyAdapter interface, implementing the two-tier cascade*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0024: Post-publication monitoring does one cheap fetch per post per cycle, never a full safety re-check*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0025: Draft version lineage via self-referencing columns on content_submission*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0026: A dedicated content_review_decision entity, separate from E4's safety review queue*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0027: Publication confirmation requires two independent, separately computed gates*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0028: Briefing Q&A as a per-creator private thread, with no response-time obligation*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0029: Briefing distribution is a point-in-time snapshot, decoupled from live view-access gating*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0030: A configurable review-deadline default and an escalation flag with no named target*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0031: Publication link verification behind a dedicated adapter, independent of E4's monitoring fetcher*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0032: Extending and exporting ContentSubmissionService for direct in-process reuse by content-workflow*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *E4, Brand safety: Summary*. Internal epic summary, Aurora project.

Aurora Project Team. (2026). *E4, Brand safety: Technical architecture*. Internal architecture specification, Aurora project.

Aurora Project Team. (2026). *E5, Briefing and content workflow: Stories*. Internal product requirements document, Aurora project.

Aurora Project Team. (2026). *E5, Briefing and content workflow: Technical architecture*. Internal architecture specification, Aurora project.

Aurora Project Team. (2026). *Product requirements document*. Internal product requirements document, Aurora project.
