# Epic E7, Analytics and Reporting: Summary

**Author:** Kaiane Cordeiro. Aurora Project, Sprint 9. **Date:** October 21, 2026.

> **TL;DR.** All six stories (US-21a, US-21b, US-22, US-37, US-43, US-46) are now implemented, tested, and pending merge. Backend: 389/389 tests passing. Frontend: 127/127 passing. Backend typecheck: clean except the 4 pre-existing, unrelated errors already on `main` before this epic. The first review pass found three real problems before merge was considered: (1) US-22 ("export a report that proves ROI," Must priority) shipped with a complete backend but no frontend and no QA coverage at all, making it unreachable by Marina; (2) the US-46 cross-client RLS escape hatch was specified in the architecture document and written into the migration's SQL, but never actually activated by any application code, a latent gap masked only by the still-unregistered `TenantContextMiddleware`; (3) a QA-authored spec file introduced three new TypeScript errors. All three were fixed before this document was finalized: a full `/app/campaigns/:id/reports` page was built and QA-covered at both the HTTP and UI layers; `ClientComparisonService` now opens a `queryRunner` transaction and issues the two required `SET LOCAL` calls before reading across client accounts, with a test asserting the calls actually happen in the right order; and the typecheck regression was corrected by narrowing an `Array.find()` result. One narrower, intentionally out-of-scope gap surfaced while fixing the RLS issue and is recorded as an open item rather than fixed here: the `account`, `campaign`, and `invoice` tables this same endpoint also reads have no equivalent cross-client RLS branch, so a correct fix to `TenantContextMiddleware` registration would still leave those three reads blocked for a true cross-client comparison. The pre-existing, epic-wide gaps already flagged by E6's own summary (no integration-test harness against a real Postgres instance, `TenantContextMiddleware` never registered) remain open and are not resolved by this epic either.

## 1. Purpose

This document summarizes what was built for Epic E7 (Analytics and Reporting), checks it against the five E7 ADRs (0044 through 0048) and the E7 architecture specification, reports the actual state of automated tests, and lists open items. It is the gate artifact reviewed before merging `feature/e7-analytics-reporting` into `main`. E7 branches from `main` (which already contains E1 through E6), so this document covers only E7's own changes, including its small, additive touches to E2's `campaign` module and E1's `agency` module.

<p align="center"><strong>Table 1</strong></p>

<p align="center"><em>Stories in Scope for Epic E7</em></p>

<div align="center">

| Story | Priority | Persona | Status |
|---|---|---|---|
| US-21a Ingest Performance Metrics from Connected Social Platforms | Should | Marina | Implemented, tested |
| US-21b Unified Dashboard: Results by Creator and by Pool | Must | Marina | Implemented, tested |
| US-22 Export a Report That Proves ROI | Must | Marina | Implemented, tested (frontend and QA coverage added after initial review) |
| US-37 See How My Content Performed | Should | Duda | Implemented, tested |
| US-43 Per-Client Reports Under Renata's Own Branding | Should | Renata | Implemented, tested |
| US-46 Compare Performance Across Clients | Could | Renata | Implemented, tested (RLS activation fixed after initial review) |

</div>

*Note.* Priority follows the MoSCoW scale defined in the product requirements document. US-21a/US-21b are sub-stories of US-21, each carrying its own FR and priority, per the same resolution E6's stories document applied to its own US-35/US-36 sub-stories.

## 2. What Was Built

**Backend** (`backend/src/analytics`): one new NestJS module, `analytics`, plus two small, additive wiring changes to modules this epic does not own. `metrics-ingestion.service.ts` implements US-21a's ingestion pipeline per ADR-0044/ADR-0045: discovery by polling `content_submission.published_at`, a pull step that never blanks last-known figures on failure, and aggregate recomputation per cycle. `adapters/social-metrics.adapter.ts` ships a stub-only `SocialMetricsAdapter`. `dashboard.service.ts`/`campaign-dashboard.controller.ts` implement US-21b's dashboard read. `campaign-report.service.ts`, `campaign-report.controller.ts`, and `generate-campaign-report.processor.ts` implement US-22's request/poll report generation, computing ADR-0046's cost-efficiency figures only when `has_deliveries` is true. `creator-performance.service.ts`/`creator-portal-performance.controller.ts` implement US-37. `client-report.service.ts`, `agency-client-report.controller.ts`, and `generate-client-report.processor.ts` implement US-43's per-client branded report. `client-comparison.service.ts`/`agency-report-compare.controller.ts` implement US-46. `performance-scoring.service.ts` implements ADR-0047's real replacement for E2's hardcoded reallocation stub. One migration (`1725000000000-AnalyticsSchema.ts`) creates the six new tables, the append-only trigger, the `has_deliveries` check constraint, and all RLS policies including `app.agency_cross_client_read`.

The two changes to modules this epic does not own: `campaign.module.ts` imports `AnalyticsModule`, and `CampaignScheduledTasksService` now calls `PerformanceScoringService.getReallocationInputs` in place of the old hardcoded `metricsFeedAvailable: false, performance: []` literals. `agency.module.ts`/`agency.controller.ts` gain `AgencyBrandingService` and `GET`/`PUT /agency/branding`, an ad-hoc contract backend-dev added to close a gap the architecture document left open (ADR-0048 specified only a read method, with no documented way for an agency to ever populate the branding profile US-43 depends on).

**Frontend** (`frontend/src`): implements all six stories' UI, across two passes. The first pass built `/app/campaigns/:id/dashboard` (US-21b), `/creator-portal/performance` (US-37), `/app/clients/:id/reports` (US-43), `/app/reports/compare` (US-46), and, as a documented follow-up once the backend contract existed, `/app/agency/branding`. The first review pass found US-22 had no frontend at all; a second pass added `/app/campaigns/:id/reports` (`campaign-report-page.tsx`), following the exact request-then-poll pattern already established by `client-report-page.tsx`, rendering spend with its `spend_source` label, cost-per-engagement/CPM figures, and the backend's explicit no-deliveries message rather than a fabricated zero.

**QA, across three rounds.** The first round covered US-21a, US-21b, US-37, US-43, and US-46 (nine new spec files, including full coverage for the then-untested `agency-branding-page.tsx`), reporting zero implementation bugs and one documentation-versus-implementation note (Section 3). A second, targeted round, triggered by the first review pass, added `campaign-report.service.spec.ts` and `campaign-report.controller.spec.ts` to close US-22's backend HTTP-layer coverage gap: 16 new tests covering the request/poll flow, `CAMPAIGN_NOT_FOUND`/`REPORT_NOT_FOUND`, tenant isolation, and the no-deliveries message. A third, small test addition accompanied the RLS activation fix itself (Section 3), asserting the `SET LOCAL` calls actually happen, in order, before the cross-client read.

## 3. Compliance With ADRs and Architecture

**ADR-0044 (`SocialMetricsAdapter`, stub only, 4-hour cadence):** followed exactly. No network call anywhere in the stub; cadence matches.

**ADR-0045 (snapshot/log/aggregate split; discovery by polling, not an E5 hook):** followed exactly. `content-workflow` is untouched by this epic's diff; discovery only reads `content_submission.published_at`.

**ADR-0046 (cost-efficiency as cost-per-engagement plus a CPM-equivalent):** followed exactly, for both the per-campaign report (US-22) and the per-client report (US-43). Both figures are `null`, never `0.00`, when `has_deliveries` is false or a denominator is zero, matching the database's own `chk_cost_efficiency_consistency` constraint.

**ADR-0047 (E2's reallocation job fed via `PerformanceScoringService`):** followed exactly, confirmed by direct inspection of the diff rather than taken on the ADR's own narrative: the hardcoded literals are genuinely gone from `campaign-scheduled-tasks.service.ts`, replaced by a real call, with `reallocation.processor.ts` itself untouched.

**ADR-0048 (US-43/US-46 on existing primitives; minimal `agency_branding_profile` ahead of E9):** followed for isolation (per-client revalidation, explicit `refused` list, 400 on an all-refused request). **One deviation was found during the first review pass and has since been fixed.** The architecture document's section 5.6 specifies that the comparison endpoint must set `app.agency_cross_client_read`/`app.current_workspace_id` before reading `campaign_performance_aggregate` across client accounts, so the RLS policy's escape-hatch branch (correctly present in the migration's SQL) can fire. `ClientComparisonService` did not do this; it read the table through ordinary repositories on the default connection. The fix: the service now injects `DataSource`, opens a `queryRunner` transaction, issues both `SET LOCAL` statements, performs the read inside that same transaction, and commits/rolls back/releases in a try/catch/finally so the flags cannot leak onto a later query on a pooled connection, mirroring the established `queryRunner` pattern already used elsewhere in this codebase (`RulesetService`). A new test asserts the session-flag calls happen, and happen before the read, using call-order assertions rather than only checking the final result. **A narrower, related gap surfaced while fixing this and was not fixed, since it was outside the specific deviation being corrected:** the same endpoint also reads `account`, `campaign`, and `invoice` tables for `client_name`, `campaign_count`, and spend figures, and none of those three tables carry an equivalent cross-client RLS branch, only `campaign_performance_aggregate` does. This is recorded as an open item (Section 7), not silently fixed, since adding RLS policy branches to tables owned by other epics is an architecture-level decision.

**The one documentation-versus-implementation mismatch from the first QA round (architecture section 5.5):** confirmed accurate and non-blocking. Architecture section 5.5 documents 404 `CLIENT_NOT_FOUND`; the actual, already-live `RolesGuard`/`AccountAccessService` path refuses with 403 `INSUFFICIENT_PRIVILEGES` before the controller is ever reached. `stories.md`'s own acceptance criterion names no status code, so both satisfy it; this is a documentation correction for whoever next edits the architecture document, not a code fix.

No other deviations between the implementation and the five ADRs or the architecture document's data model were found.

## 4. Test Results

<p align="center"><strong>Table 2</strong></p>

<p align="center"><em>Automated Test Results by Package, Final State</em></p>

<div align="center">

| Package | Command | Result |
|---|---|---|
| Backend | `npx vitest run` (from `backend/`) | 64 test files, 389 tests, all passing |
| Frontend | `npx vitest run` (from `frontend/`) | 31 test files, 127 tests, all passing |
| Backend typecheck | `npx tsc --noEmit` (from `backend/`) | 4 errors, all pre-existing and unrelated (`campaign.service.additional.spec.ts`, present on `main` before this epic); zero errors introduced by this epic as of the final state |

</div>

Backend coverage specific to this epic now includes, beyond the first round's files: `campaign-report.service.spec.ts` and `campaign-report.controller.spec.ts` (US-22's HTTP layer, added after the first review pass), and the extended `client-comparison.service.spec.ts` (the RLS session-flag activation test, added with the ADR-0048 fix). Frontend coverage now includes `campaign-report-page.spec.tsx` for US-22, alongside the first round's `campaign-dashboard-page.spec.tsx`, `client-report-page.spec.tsx`, `reports-compare-page.spec.tsx`, `agency-branding-page.spec.tsx`, and `performance-page.spec.tsx`.

## 5. Story Coverage

<p align="center"><strong>Table 3</strong></p>

<p align="center"><em>Story Coverage Against Automated Tests, Final State</em></p>

<div align="center">

| Story | Priority | Backend evidence | Frontend evidence | Final verdict |
|---|---|---|---|---|
| US-21a | Should | `metrics-ingestion.service.spec.ts`, `adapters/social-metrics.adapter.spec.ts` | n/a (backend infrastructure) | Meets acceptance criteria |
| US-21b | Must | `dashboard.service.spec.ts` | `campaign-dashboard-page.spec.tsx` | Meets acceptance criteria |
| US-22 | Must | `generate-campaign-report.processor.spec.ts`, `campaign-report.service.spec.ts`, `campaign-report.controller.spec.ts` | `campaign-report-page.spec.tsx` | Meets acceptance criteria |
| US-37 | Should | `creator-performance.service.spec.ts` | `performance-page.spec.tsx` | Meets acceptance criteria |
| US-43 | Should | `client-report.service.spec.ts`, `generate-client-report.processor.spec.ts`, `agency-client-report-access.spec.ts`, `agency-branding.service.spec.ts` | `client-report-page.spec.tsx`, `agency-branding-page.spec.tsx` | Meets acceptance criteria |
| US-46 | Could | `client-comparison.service.spec.ts` (including the RLS session-flag assertion) | `reports-compare-page.spec.tsx` | Meets acceptance criteria |

</div>

All six stories in scope now have corresponding passing test evidence at both the backend and frontend layers where applicable, and a working, reachable UI.

## 6. Deviations Summary

1. **Found and fixed before merge:** US-22 had no frontend and no QA coverage after the first implementation pass. Both were built and added; see Sections 2 and 4.
2. **Found and fixed before merge:** the US-46 RLS escape hatch was specified and present in the migration's SQL but never activated by application code. `ClientComparisonService` now sets the required session flags inside a scoped transaction; see Section 3.
3. **Found and fixed before merge:** a QA-authored spec file introduced 3 new TypeScript errors from an un-narrowed `Array.find()` result. Corrected alongside the RLS fix; confirmed by re-running `tsc --noEmit`.
4. **Disclosed, confirmed accurate, non-blocking:** architecture section 5.5's documented 404 does not match the actual, already-live 403 refusal for an inaccessible client. Both satisfy the stories document's acceptance criterion.
5. **Disclosed and unresolved, by design:** the cost-efficiency formula, the reallocation score formula, the branding granularity assumption (workspace-level, not client-level), and the metric-retention period are architectural defaults open to a later product decision.
6. **Disclosed and unresolved, newly surfaced while fixing item 2 above, intentionally not fixed in this epic:** `account`, `campaign`, and `invoice` have no cross-client RLS branch equivalent to the one added to `campaign_performance_aggregate`. A correct `TenantContextMiddleware` registration would still leave a true cross-client comparison partially blocked until this is addressed, since those three tables feed `client_name`, `campaign_count`, and spend figures into the same comparison response.

## 7. Open Items for the Next Epic

- Add a cross-client RLS read branch to `account`, `campaign`, and `invoice` consistent with the one just added to `campaign_performance_aggregate`, so US-46 is genuinely complete once `TenantContextMiddleware` registration is fixed, not newly broken by it.
- Register `TenantContextMiddleware` correctly in `app.module.ts` and add an RLS-coverage test; unresolved across seven epics now (E1 through E7), and now blocking the correctness of two separate escape-hatch mechanisms (E6's `app.aurora_operator`, E7's `app.agency_cross_client_read`).
- Stand up a real-Postgres integration-test harness, per E6's own unresolved recommendation, now also needed to verify this epic's RLS policies against an actual database rather than by migration inspection alone.
- Correct architecture document section 5.5 to state the actual 403 behavior, or make a deliberate decision to change the guard to return 404 instead, so the document and the code agree either way.
- Bring the stories document's remaining open questions (cost-efficiency formula validation, reallocation score formula, branding granularity, metric retention) to product for a decision.
- When E8 ships real OAuth tokens, build the real per-platform `SocialMetricsAdapter` implementation(s), and give a creator a way to clear a `stale_auth_revoked` snapshot by reconnecting her account.
- When E9 is written, extend `agency_branding_profile` rather than replace it, and resolve whether branding should be client-level rather than workspace-level.

## References

Aurora Project Team. (2026). *ADR-0032: Extending and exporting ContentSubmissionService for direct in-process reuse by content-workflow*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0036: Payout obligation creation wired via an exported PayoutObligationService, called from E5's publication-confirmation transaction*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0044: Performance metrics ingestion isolated behind a SocialMetricsAdapter, with only a stub implementation and a fixed 4-hour cadence in this pilot*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0045: Metric data modeled as snapshot, append-only log, and pre-computed aggregate; ingestion discovers new publications by polling, not a hook into E5's transaction*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0046: Cost-efficiency figure defined as cost-per-engagement plus a CPM-equivalent, an architectural default*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0047: E2's reallocate-budget job fed via an exported PerformanceScoringService, replacing the hardcoded metricsFeedAvailable: false stub*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0048: US-43 and US-46 built against existing workspace/account/operator-access primitives, with one minimal agency_branding_profile entity introduced ahead of E9*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *E2, Campaign planning and pool buying: Technical architecture*. Internal architecture specification, Aurora project.

Aurora Project Team. (2026). *E6, Payments and financial transparency: Summary*. Internal epic summary, Aurora project.

Aurora Project Team. (2026). *E7, Analytics and reporting: Stories*. Internal product requirements document, Aurora project.

Aurora Project Team. (2026). *E7, Analytics and reporting: Technical architecture*. Internal architecture specification, Aurora project.

Aurora Project Team. (2026). *Product requirements document*. Internal product requirements document, Aurora project.
