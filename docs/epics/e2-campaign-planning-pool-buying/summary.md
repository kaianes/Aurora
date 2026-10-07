# Epic E2, Campaign Planning and Pool Buying: Summary

**Author:** Kaiane Cordeiro. Aurora Project, Sprint 5. **Date:** October 5, 2026.

> **TL;DR.** All 6 stories implemented, tested, and pending merge. Backend: 54/54 tests passing. Frontend: 13/13 tests passing (the jsdom/undici issue from E1 is fixed here by pinning jsdom). QA found 2 real bugs in shortfall resolution (one missing API field, one missing validation); both fixed and re-verified before this review. Known gaps, by design: automatic budget reallocation (US-10) is complete but inert until a future epic's metrics feed exists, and the row-level-security middleware gap from E1 is still unresolved.

## 1. Purpose

This document summarizes what was built for Epic E2 (Campaign Planning and Pool Buying), checks it against the ADRs and architecture specification, reports the actual state of automated tests, and lists open items. It is the gate artifact reviewed before merging `feature/e2-campaign-planning-pool-buying` into `main`.

<p align="center"><strong>Table 1</strong></p>

<p align="center"><em>Stories in Scope for Epic E2</em></p>

<div align="center">

| Story | Priority | Persona | Status |
|---|---|---|---|
| US-05 Define a Campaign Once | Must | Marina | Implemented, tested |
| US-06 See Pool Size, Reach, and Price Before Confirming | Must | Marina | Implemented, tested (stub matching engine) |
| US-07 Buy the Pool at One Fixed Price | Must | Marina | Implemented, tested on backend; frontend choice UI did not match acceptance criterion, fixed post-review (see Section 3) |
| US-08 Save a Campaign as a Reusable Template | Should | Marina | Implemented, tested |
| US-09 Pause, Resume, or Cancel a Running Campaign | Must | Marina | Implemented, tested |
| US-10 Automatic Budget Reallocation to Best-Performing Creators | Should | Marina | Implemented, tested; depends on an FR-52 metrics feed that does not exist yet |

</div>

*Note.* Priority follows the MoSCoW scale defined in the product requirements document.

## 2. What Was Built

**Backend** (`backend/src/campaign`): one new NestJS module, `campaign`, covering all six stories: `campaign.controller.ts` and `campaign.service.ts` (US-05 through US-07, US-09), `template.controller.ts` and `template.service.ts` (US-08), `quote.processor.ts` (asynchronous quote computation against a stub matching engine, `matching-engine.adapter.ts`), `pool-fill-check.processor.ts` and the shortfall logic inside `campaign.service.ts` (US-07 scenario 3, ADR-0008), `reallocation.processor.ts` and `campaign-scheduled-tasks.service.ts` (US-10, ADR-0007). One TypeORM migration (`database/migrations/1700000000000-CampaignSchema.ts`) creates the eight new tables from architecture section 2.1, their RLS policies, and the three triggers (append-only state-transition log, append-only reallocation-event log, non-decreasing `committed_budget`). `CampaignModule` is registered in `AppModule`.

**Frontend** (`frontend/src`): implements the route map from architecture section 5 (`/app/campaigns`, `/app/campaigns/new`, `/app/campaigns/:id`, `/app/campaigns/:id/shortfall`, `/app/templates`, `/app/templates/:id/instantiate`), reusing the API client, role helper (`canWriteCampaign`, `canResolveShortfall` added to `frontend/src/lib/roles.ts`), and existing UI kit from E1.

**QA round 1 findings and resolution.** QA found two real backend bugs in `campaign.service.ts`: `formatShortfall` omitted `choice_offered` from the `GET /campaigns/:id/shortfall` response, and `resolveShortfall` did not validate the submitted `resolution_type` against the options actually offered for that shortfall (ADR-0008's threshold rule). Both were fixed: `formatShortfall` now includes `choice_offered`, and `resolveShortfall` rejects `partial_refund` when `shortfall.choiceOffered` is false, returning `RESOLUTION_TYPE_NOT_OFFERED`. Separately, the frontend test suite was unblocked by downgrading `jsdom` to 25.0.1, which resolved an incompatibility between `jsdom`'s `CacheStorage` shim and the `undici` version used under Node 20; this was an environment fix, not an application-code change.

**Reviewer round 1 finding and resolution.** The final review pass found a third, frontend-only bug that QA's round 1 had not caught: `shortfall-page.tsx` decided whether to show the refund-vs-revised-guarantee choice using `shortfall.chosen_by === 'buyer'`, a field that is only ever `'buyer'` *after* the buyer has already resolved the shortfall — so the choice UI could never render before resolution, for any shortfall size. This broke US-07 scenario 3's acceptance criterion outright. It has been fixed: the page now branches on `shortfall.choice_offered && !shortfall.resolved_at`, matching the field the backend fix in round 1 added to the API response. The corresponding test in `shortfall-page.spec.tsx` (previously named to document the bug as expected behavior) was corrected to assert the fixed behavior, and the full frontend suite (13 tests, 3 files) still passes.

## 3. Compliance With ADRs and Architecture

**ADR-0005 (Campaign Pool Allocation as a Per-Creator Row Table):** followed. `campaign_pool_member` is a dedicated table, one row per creator, with `allocated_budget`, `committed_budget`, and an `original_budget` column needed for ADR-0007's floor calculation. The `prevent_committed_budget_decrease` trigger matches the architecture's SQL.

**ADR-0006 (Explicit Campaign State Machine):** followed in `campaign.service.ts`. Every lifecycle handler (`confirm`, `pause`, `resume`, `cancel`, `requestQuote`) checks the current state before mutating anything and rejects with `INVALID_STATE_TRANSITION` otherwise, writing a `campaign_state_transition` row on every successful transition. One structural deviation: the state machine logic lives inline across handler methods in `CampaignService` rather than as a separate, reusable `CampaignStateMachine` service. The behavioral guarantee (consistent transition table, consistent error shape, append-only log) is met; a future epic needing to trigger a transition would have to depend on `CampaignService` directly rather than a dedicated service.

**ADR-0007 (Default Reallocation Bounds and the Floor):** followed closely in `reallocation.processor.ts` and `campaign.service.ts`. Bounds default to `enabled: false`, `max_shift_pct: 20`, `min_guaranteed_share_pct: 50` on confirmation. The processor clamps shifts, floors remaining allocation correctly, never touches `committed_budget`, and skips cleanly on no-data or stale-metrics cycles. `CampaignScheduledTasksService.scheduleReallocation` always enqueues jobs with `metricsFeedAvailable: false`, because the FR-52 metrics feed does not exist in this epic's scope — expected and disclosed, but it means reallocation cannot apply a real change end-to-end yet.

**ADR-0008 (Partial Refund vs. Revised Guarantee Criteria):** followed, including the frontend after the round-2 fix described in Section 2. `recordShortfall` sets `choiceOffered` at the 15% threshold exactly as specified; `resolveShortfall` rejects any `resolution_type` not actually offered; and `shortfall-page.tsx` now correctly renders the choice UI when `choice_offered` is true and the shortfall is unresolved, letting Marina pick a partial refund or accept the revised guarantee, as US-07 scenario 3 requires.

**ADR-0009 (Campaign Minimum Budget Threshold):** followed exactly. R$ 2,000.00 is enforced in both the database constraint (`chk_campaign_minimum_budget`) and the application layer (`validateBudget`, returning 422 `BUDGET_BELOW_MINIMUM`).

**ADR-0010 (Template Library Scope):** followed. `campaign_template` is `account_id`-scoped; `TemplateService.list` and `.instantiate` filter by `accountId` only, with no per-user visibility filter, matching the decision that any account member with campaign-creation rights sees every template in that account.

**RLS, inherited pattern from E1:** the migration defines RLS policies for all eight new tables, matching architecture section 2.4. As in E1, application code filters by `accountId` explicitly rather than relying on `TenantContextMiddleware` (not registered in `AppModule`), so these RLS policies are not an executed second line of defense at runtime. No live data leak was found in this epic's services, which consistently filter by `accountId`, but this is a carried-over item from the E1 review, not resolved here.

## 4. Test Results

<p align="center"><strong>Table 2</strong></p>

<p align="center"><em>Automated Test Results by Package</em></p>

<div align="center">

| Package | Command | Result |
|---|---|---|
| Backend | `npx vitest run src/campaign` (from `backend/`) | 7 test files, 54 tests, all passing |
| Frontend | `npx vitest run` (from `frontend/`) | 3 test files, 13 tests, all passing |

</div>

Backend coverage spans `campaign.service.spec.ts`, `campaign.service.additional.spec.ts` (the two QA-found bugs and their fixes), `template.service.spec.ts`, `matching-engine.adapter.spec.ts`, `pool-fill-check.processor.spec.ts`, `reallocation.processor.spec.ts`, and `dto/reallocation-bounds.dto.spec.ts`. The frontend's 13 tests are concentrated in `pricing-page.spec.tsx` and `register-page.spec.tsx` (carried over from E1, now executing after the `jsdom` downgrade) and `shortfall-page.spec.tsx` (new in E2, now asserting the corrected choice-UI behavior). No frontend spec file exists for `campaigns-page.tsx`, `campaign-form-page.tsx`, `campaign-detail-page.tsx`, `templates-page.tsx`, or `template-instantiate-page.tsx`.

## 5. Story Coverage

<p align="center"><strong>Table 3</strong></p>

<p align="center"><em>Story Coverage Against Automated Tests and QA Results</em></p>

<div align="center">

| Story | Priority | Backend evidence | Frontend evidence | Final verdict |
|---|---|---|---|---|
| US-05 | Must | Draft creation, partial save, budget-below-minimum (422), narrow targeting (422) | none (`campaign-form-page.tsx` has no spec) | Backend verified; frontend unverified by automated test |
| US-06 | Must | Ready, no-viable-pool, timeout-to-failed paths | none | Matches architecture's async quote contract |
| US-07 | Must | Confirm, lock price, shortfall record and resolve, including both QA-found bug fixes | `shortfall-page.spec.tsx`: choice UI now correctly gated on `choice_offered` | Meets acceptance criteria after round-2 fix |
| US-08 | Should | Save excludes budget/pool/performance data, instantiate pre-fills and computes drift | none | Matches ADR-0010 and architecture section 3.7 |
| US-09 | Must | Pause/resume/cancel and invalid-transition rejection | none | Matches ADR-0006 and the transition table |
| US-10 | Should | Applied, skipped-no-data, skipped-stale-metrics, floor and cap enforcement | none | Matches ADR-0007; inert today pending the FR-52 metrics feed, by design |

</div>

## 6. Deviations Summary

1. **Resolved before merge:** the shortfall resolution page did not offer the buyer a choice between partial refund and revised guarantee, for any shortfall size, because it read the wrong field from the API response. Found in final review, fixed, and re-verified.
2. **Carried over from E1, not fixed here:** row-level security is defined correctly on all eight new tables but is not engaged at runtime, since `TenantContextMiddleware` remains unregistered. Isolation relies on explicit `accountId` filtering in application code, checked and found consistent in this module.
3. **Moderate:** the campaign state machine (ADR-0006) is correctly enforced but implemented as logic distributed across `CampaignService` methods rather than as a single reusable service.
4. **Moderate, expected and disclosed:** US-10's reallocation logic is correct and tested in isolation but cannot apply a real reallocation today, because the FR-52 metrics feed it depends on is out of this epic's scope.
5. **Minor:** no frontend test exists for `campaigns-page.tsx`, `campaign-form-page.tsx`, `campaign-detail-page.tsx`, `templates-page.tsx`, or `template-instantiate-page.tsx`.

## 7. Open Items for the Next Epic

- Register the tenant-context middleware correctly and add an RLS-coverage test, as already flagged in the E1 summary.
- Consider extracting `CampaignStateMachine` as its own service per ADR-0006's stated intent, before E5's content workflow needs to trigger a transition itself.
- Add frontend specs for the five untested campaign pages.
- Plan the FR-52 metrics feed integration explicitly in E3 or a dedicated follow-up, since US-10 is otherwise complete but inert without it.
- Pin the `jsdom` version in `frontend/package.json` to avoid a repeat of the test-runner blocker (already done this round; keep it pinned).

## References

Aurora Project Team. (2026). *ADR-0005: Campaign pool allocation as a per-creator row table*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0006: Explicit campaign state machine enforced in the application layer*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0007: Default reallocation bounds and the floor on creator allocation*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0008: Criteria for offering partial refund vs. revised guarantee on pool shortfall*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0009: Campaign minimum budget threshold*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0010: Campaign template library scope, account-level, not user-private*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *E1, Access and onboarding: Summary*. Internal epic summary, Aurora project.

Aurora Project Team. (2026). *E2, Campaign planning and pool buying: Stories*. Internal product requirements document, Aurora project.

Aurora Project Team. (2026). *E2, Campaign planning and pool buying: Technical architecture*. Internal architecture specification, Aurora project.
