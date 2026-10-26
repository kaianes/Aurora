# Epic E4, Brand Safety: Summary

**Author:** Kaiane Cordeiro. Aurora Project, Sprint 6. **Date:** October 21, 2026.

> **TL;DR.** All 3 Must stories (US-15, US-16, US-17) and the 1 Could story (US-16b) implemented, tested, and pending merge. Backend: 185/185 tests passing (E1 through E4 combined). Frontend: 48/48 passing. New `brand-safety` module behind a `ContentSafetyAdapter` port (ADR-0021), a minimal `content_submission` entity ahead of E5 (ADR-0020), rule-level ruleset supersession (ADR-0019), a 10-minute check-timeout-to-human-review path (ADR-0022), a never-mutate-the-automated-verdict review decision model (ADR-0023), and a deliberately shallow post-publication monitor (ADR-0024). QA found zero implementation bugs and closed five coverage gaps. This review independently re-read the diff against every ADR and the architecture contract and found no deviations in the implemented behavior. Two items are confirmed as correct readings of an underspecified contract, not deviations: PATCH's field-merge semantics on `definition`, and the lack of any file-upload endpoint behind `media_asset_url`. Known gaps, by design: `TenantContextMiddleware` remains unregistered (carried over from E1 through E3), both tiers of the safety cascade are deterministic stand-ins for the real Claude Haiku/Opus cascade, and several PRD open questions remain explicitly unresolved per the stories document.

## 1. Purpose

This document summarizes what was built for Epic E4 (Brand Safety), checks it against the six E4 ADRs and the E4 architecture specification, reports the actual state of automated tests, and lists open items. It is the gate artifact reviewed before merging `feature/e4-brand-safety` into `main`. Unlike E2 and E3, which built on each other's unmerged branches, E4 branches directly from `main` (which already contains E1, E2, and E3), so this review's diff (`git diff main...feature/e4-brand-safety`) covers only E4's own changes.

<p align="center"><strong>Table 1</strong></p>

<p align="center"><em>Stories in Scope for Epic E4</em></p>

<div align="center">

| Story | Priority | Persona | Status |
|---|---|---|---|
| US-15 Define Brand Safety Rules and Prohibited Topics | Must | Marina | Implemented, tested |
| US-16 Message-Level Check Before Publication | Must | Marina | Implemented, tested |
| US-16b Monitor Published Content for Deviations | Could | Marina | Implemented, tested |
| US-17 Flagged Content Routed to a Human Decision | Must | Marina | Implemented, tested |

</div>

*Note.* Priority follows the MoSCoW scale defined in the product requirements document. US-16b is a sub-story of US-16, tagged US-16 in the stories document, but tracked separately here because it has its own acceptance criteria and its own governing ADR (ADR-0024).

## 2. What Was Built

**Backend** (`backend/src/brand-safety`): one new NestJS module, `brand-safety`, covering all four stories. `ruleset.service.ts`/`ruleset.controller.ts`/`campaign-safety-ruleset.controller.ts` implement US-15: brand-level rule CRUD, transactional bulk create/update/delete, the campaign-level override endpoints, and the effective-ruleset read computed at query time per ADR-0019's set-subtraction-and-union rule. `content-submission.service.ts`/`content-submission-intake.controller.ts` implement the one creator-facing intake endpoint (US-16, ADR-0020), guarded by E3's `CreatorAuthGuard`. `run-safety-check.processor.ts` orchestrates the check against `content-safety.adapter.ts`'s `RealContentSafetyAdapter`, bound behind the `CONTENT_SAFETY_ADAPTER` DI token exactly as ADR-0021 specifies; `extract-content-channels.processor.ts` runs OCR/ASR behind a separate `MediaExtractionAdapter`. `brand-safety-gate.service.ts` exposes the two-method `BrandSafetyGateService` interface (section 3.6 of the architecture doc) that a future E5 and payments module are meant to depend on, with `recordPublication` also reachable through a thin HTTP wrapper for the current gap period. `review-queue.service.ts`/`review-queue.controller.ts` implement US-17, including the fail-closed, append-only decision model of ADR-0023. `brand-safety-scheduled-tasks.service.ts` runs the two cron jobs: `expire-pending-checks` (ADR-0022) and `monitor-published-content` (ADR-0024), the latter via a `LiveContentFetcher` port. `monitoring.service.ts`/`monitoring.controller.ts` expose US-16b's read endpoints. One migration (`1710000000000-BrandSafetySchema.ts`) creates the seven new tables, their check constraints, and RLS policies.

**Frontend** (`frontend/src`): implements the route map from architecture section 5: `/app/safety/ruleset` (brand ruleset editor), `/app/campaigns/:id/safety-ruleset` (campaign effective-ruleset view with `source`/`override_action` badges), `/app/safety/review-queue` and `/app/safety/review-queue/:id` (queue list and decision detail, with an explicit error state on a 503), `/app/safety/monitoring` (published-content monitoring list), and `/creator-portal/submissions/new` (the minimal creator intake form, polling the check endpoint to resolution).

**QA round.** QA found zero implementation bugs. It closed five test-coverage gaps the dev pass had left open: `safety-check.controller.spec.ts`, `gate-unaffected-by-queue-outage.spec.ts`, `monitoring.service.spec.ts`, `review-queue-detail-page.spec.tsx`, and `new-submission-page.spec.tsx`. Notably, `gate-unaffected-by-queue-outage.spec.ts` is a direct test of ADR-0023's central claim, that a degraded review-queue read path cannot flip the gate to cleared as a side effect, which this review independently re-confirmed by reading `BrandSafetyGateService` and `ReviewQueueService`: the two services query disjoint tables for disjoint purposes, so a `ServiceUnavailableException` thrown inside `ReviewQueueService.list`/`getDetail` has no code path into `BrandSafetyGateService.getGateStatus` at all.

**This review's independent re-read.** This review re-read the diff against all six ADRs and the full architecture contract, not just QA's report. Two points the backend-dev and frontend-dev flagged while building were specifically checked:

1. **PATCH rule-update as field-merge, not wholesale replace.** Confirmed correct, not a deviation. Architecture section 3.2 states the endpoint performs a "partial update of `definition` only" and "re-validates the merged definition." `ruleset.service.ts`'s `updateBrandRule` and `updateCampaignOverride` (and the bulk-update path) both compute `{ ...existing.definition, ...dto.definition }`, validate the merged result against section 2.3's rules before writing anything, and leave the rule untouched on validation failure, exactly matching US-15 scenario 3's requirement and the architecture's own wording. There is no ADR governing this specific mechanic, but it does not contradict any of the six; it is a correct reading of an explicit (if terse) architecture instruction.
2. **No file-upload endpoint behind `media_asset_url`.** Confirmed as a genuine, pre-existing contract gap, not an implementation deviation. The architecture's `POST /creator-portal/content-submissions` request body (section 3.3) takes `media_asset_url` as a literal string (`"s3://aurora-drafts/creator-9001/draft-01.mp4"`), with no corresponding upload endpoint defined anywhere in the architecture document, the ADRs, or the stories document. The implementation matches this literally: `CreateContentSubmissionDto.media_asset_url` is a plain optional string, and the frontend's `new-submission-page.tsx` renders it as a text input with an explicit code comment stating this is a known gap rather than an invented endpoint. This is correctly left unresolved rather than papered over with a fabricated upload flow; it is recorded in Section 7 below as an open item.

No other deviations between the implementation and the ADRs/contracts were found. One implementation choice not explicitly spelled out in architecture section 2.5's RLS code samples, but consistent with E3's own precedent (and with the architecture document's own statement that E4 "reuses E3's `creator-portal` auth guard"): the RLS policies on `content_submission`, `safety_check`, and `safety_rule_trigger` add an `OR current_setting('app.creator_portal', true) = 'true'` branch so the one creator-facing endpoint in this epic can read/write rows with no `account_id` context. This mirrors the identical pattern already shipped in E3's `MatchingSchema` migration for `campaign_shortlist_entry`/`campaign_opportunity`, and is noted here for completeness rather than flagged as a deviation, since the architecture document's narrative (if not its SQL listing) explicitly calls for the creator-portal path to work.

## 3. Compliance With ADRs and Architecture

**ADR-0019 (Rule-Level Supersession, Not Whole-Ruleset Replacement or Field Merge):** followed. `safety_rule.action`/`supersedes_rule_id` match the schema exactly; `resolveEffectiveRuleRows` in `ruleset.service.ts` computes the effective set as every brand rule not named by a `replace`/`suppress` override, plus every campaign-scope rule, with no content-based comparison anywhere in the code. `GET /campaigns/:id/safety-ruleset`'s response includes `has_override`, `source`, and `override_action` exactly as specified.

**ADR-0020 (Minimal `content_submission` Entity Ahead of E5):** followed. The entity carries exactly the fields the ADR lists and no more; no draft-versioning, review state machine, or rejection-reason field was added. The one HTTP endpoint is scoped and commented as a gap-filler, and `BrandSafetyGateService`'s two methods are the documented long-term contract.

**ADR-0021 (Pluggable `ContentSafetyAdapter`, Two-Tier Cascade):** followed structurally. `RealContentSafetyAdapter` is bound behind `CONTENT_SAFETY_ADAPTER` and is the only thing `run-safety-check.processor.ts` depends on for judgment; the adapter never writes to the database, matching the "pure function of its input" requirement. `MediaExtractionAdapter` is a genuinely separate interface, not folded into the safety adapter, as required. One disclosed, expected gap (not a deviation, since no ADR or architecture passage claims otherwise for this build): the "two-tier cascade" is implemented as a deterministic rule-matching tier 1 (exact substring/regex/competitor match) and a stub tier 2 that confirms tier-1's ambiguous partial-overlap signals, not an actual call to Claude Haiku/Opus. This is consistent with the epic's own framing throughout the architecture document that NFR-34's cost claims and the escalation rate are unmeasured pre-launch (risk R-01), and the code's own comments are explicit about this being a placeholder. It should not be read as a violation of ADR-0021, which specifies the adapter *boundary*, not a commitment that this particular epic wires a real model behind it yet.

**ADR-0022 (Check Timeout Treated as Blocking, 10-Minute Hard Timeout):** followed exactly. `safety_check.timeout_at = requested_at + 10 minutes` is set at creation in `content-submission.service.ts`; `expirePendingChecks` (cron, every 2 minutes per the architecture doc's job table) finds stale `pending` rows, transitions them to `check_unavailable`, writes the single `channel = 'system'`/`rule_id = null` trigger row, and creates a `reason_category = 'check_unavailable'` review item, matching the ADR and section 2.7's state machine precisely.

**ADR-0023 (Human Review Overrides the Gate Without Mutating the Verdict; Fails Closed):** followed exactly. `ReviewQueueService.decide` never touches `safety_check`; it writes only to `safety_review_queue_item`. `BrandSafetyGateService.getGateStatus` reads both records and has no code path that defaults to `cleared` on a missing row, matching section 2.8's table row for row. The queue's `list`/`getDetail` wrap any unexpected error (not already an `HttpException`) in a structured 503 `REVIEW_QUEUE_UNAVAILABLE`, verified independently by this review to have no effect on gate computation, per the dedicated QA spec noted in Section 2.

**ADR-0024 (Lightweight Post-Publication Monitoring):** followed exactly. `monitorPublishedContent` calls `LiveContentFetcher.fetchLiveCaption` once per active snapshot per 6-hour cycle, compares only the caption against the approved snapshot, never re-extracts on-screen text or audio, never re-runs the safety cascade, and overwrites `last_result`/`deviation_details` in place with no history table, matching the ADR's explicit scope limit.

**Known, disclosed gaps, confirmed accurate, not fixed in this epic:**
1. `TenantContextMiddleware` remains unregistered in `AppModule`, carried over from E1 through E3 and unchanged by this epic. Application code continues to filter explicitly by `accountId`/`creatorId` (and, for the one creator-portal endpoint, by the `app.creator_portal` RLS escape hatch), checked and found consistent in this module.
2. The content-safety cascade's two tiers are both deterministic placeholders standing in for the real Claude Haiku/Opus cascade `docs/architecture.md` QAS-02 specifies; swapping them in is scoped to `RealContentSafetyAdapter`'s implementation only, per ADR-0021's own design intent.
3. `media_asset_url` has no corresponding upload endpoint anywhere in this epic's contract (see Section 2's independent-review finding); the creator-portal form accepts it as a pasted string.
4. PRD open questions 2, 4, and 6 (mid-campaign ruleset changes retroactively affecting already-checked content; no SLA on human review itself; whether purely visual content with no text/audio is in scope) are explicitly left unresolved, consistent with the stories document's own framing.

## 4. Test Results

<p align="center"><strong>Table 2</strong></p>

<p align="center"><em>Automated Test Results by Package</em></p>

<div align="center">

| Package | Command | Result |
|---|---|---|
| Backend | `npx vitest run` (from `backend/`) | 31 test files, 185 tests, all passing |
| Frontend | `npx vitest run` (from `frontend/`) | 14 test files, 48 tests, all passing |

</div>

Both totals were independently re-run by this review and matched QA's reported figures exactly. Backend coverage includes `ruleset.service.spec.ts`, `content-submission.service.spec.ts`, `run-safety-check.processor.spec.ts`, `brand-safety-gate.service.spec.ts`, `review-queue.service.spec.ts`, `brand-safety-scheduled-tasks.service.spec.ts`, `content-safety.adapter.spec.ts`, plus QA's additions: `safety-check.controller.spec.ts`, `gate-unaffected-by-queue-outage.spec.ts`, and `monitoring.service.spec.ts`. Frontend coverage includes `safety-ruleset-page.spec.tsx`, `campaign-safety-ruleset-page.spec.tsx`, `review-queue-page.spec.tsx`, `monitoring-page.spec.tsx`, plus QA's additions: `review-queue-detail-page.spec.tsx` and `new-submission-page.spec.tsx`.

## 5. Story Coverage

<p align="center"><strong>Table 3</strong></p>

<p align="center"><em>Story Coverage Against Automated Tests and QA Results</em></p>

<div align="center">

| Story | Priority | Backend evidence | Frontend evidence | QA result | Final verdict |
|---|---|---|---|---|---|
| US-15 | Must | Brand/campaign rule CRUD, bulk transactional validation, effective-ruleset computation, supersession | `safety-ruleset-page.spec.tsx`, `campaign-safety-ruleset-page.spec.tsx` | PASS | Meets acceptance criteria |
| US-16 | Must | Intake, extraction hand-off, cascade evaluation, multi-channel aggregation, gate refusal | `new-submission-page.spec.tsx` | PASS | Meets acceptance criteria |
| US-16b | Could | Monitoring cron, matching/deviated/unreachable states | `monitoring-page.spec.tsx` | PASS | Meets acceptance criteria |
| US-17 | Must | Queue list/detail, decide with reason enforcement, 503 fail-closed, gate-unaffected-by-outage | `review-queue-page.spec.tsx`, `review-queue-detail-page.spec.tsx` | PASS | Meets acceptance criteria |

</div>

All four stories in scope (three Must, one Could) have a corresponding passing QA result; none shipped without one.

## 6. Deviations Summary

1. **Confirmed correct reading, not a deviation:** PATCH rule-update implements field-merge-then-revalidate semantics on `definition`, matching architecture section 3.2's explicit wording ("re-validates the merged definition").
2. **Confirmed genuine contract gap, not an implementation deviation:** no file-upload endpoint exists anywhere in this epic's contract for `media_asset_url`; the field is a literal string in both the architecture document and the implementation. Flagged as an open item below, since it will need resolving before the creator-portal intake flow is anything more than a demo path.
3. **Disclosed and unresolved, by design:** `TenantContextMiddleware` remains unregistered, carried over from E1 through E3 unchanged.
4. **Disclosed and unresolved, by design:** both tiers of the content-safety cascade are deterministic placeholders, not the real Claude Haiku/Opus cascade the platform architecture specifies; this is consistent with ADR-0021's adapter-boundary design (which this epic satisfies) and not a claim that the real model integration shipped.
5. **Disclosed and unresolved, by design:** PRD open questions 2, 4, and 6 remain unresolved, per the stories document's own framing.

No deviation found in this review contradicts an ADR or the architecture contract's endpoint/data-model shapes.

## 7. Open Items for the Next Epic

- Define and build a file-upload endpoint (or equivalent presigned-URL flow) for `media_asset_url` before the creator-portal intake form is used for anything beyond a demo/QA path; this is a gap in the contract itself, not a bug in this epic's build of it.
- Replace both tiers of `RealContentSafetyAdapter` with real Claude Haiku (tier 1) and Claude Opus (tier 2) calls behind the existing `ContentSafetyAdapter` interface, including the cached-ruleset-prefix mechanism NFR-34's cost claim depends on; measure the actual escalation rate against the ~15% assumption in `docs/architecture.md` risk R-01.
- Register the tenant-context middleware correctly and add an RLS-coverage test; unresolved across four epics now (E1 through E4).
- When E5 ships FR-39, decide how its draft/version history relates to the `content_submission` rows this epic already created (ADR-0020's named seam), and have E5's publication-recording code call `BrandSafetyGateService.recordPublication` directly rather than continuing to rely on this epic's thin HTTP wrapper.
- Bring PRD open questions 2 (mid-campaign ruleset changes and already-checked content), 4 (no SLA on human review), and 6 (purely visual content with no text/audio) to product for a decision; none are resolved by this epic, by design.
- Revisit the 10-minute check-timeout threshold and the 6-hour monitoring cadence once real production latency and engagement data exist; both are explicitly pilot defaults in their governing ADRs (ADR-0022, ADR-0024).

## References

Aurora Project Team. (2026). *ADR-0019: Campaign ruleset overrides work by rule-level supersession, not whole-ruleset replacement or field merge*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0020: A minimal content_submission entity, owned by E4 only until E5 ships*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0021: Content safety judgment isolated behind a ContentSafetyAdapter interface, implementing the two-tier cascade*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0022: A safety check that cannot complete blocks publication exactly like a flag, after a 10-minute hard timeout*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0023: A human review decision overrides the gate without mutating the automated verdict; the queue fails closed*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0024: Post-publication monitoring does one cheap fetch per post per cycle, never a full safety re-check*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *E3, Creator matching and curation: Summary*. Internal epic summary, Aurora project.

Aurora Project Team. (2026). *E4, Brand safety: Stories*. Internal product requirements document, Aurora project.

Aurora Project Team. (2026). *E4, Brand safety: Technical architecture*. Internal architecture specification, Aurora project.

Aurora Project Team. (2026). *Product requirements document*. Internal product requirements document, Aurora project.
