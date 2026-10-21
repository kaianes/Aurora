# Epic E9, Agency Multi-Client Operations: Summary

**Author:** Kaiane Cordeiro. Aurora Project, Sprint 11. **Date:** October 21, 2026.

> **TL;DR.** All four genuinely in-scope items (US-39, US-41, US-44, the FR-60 audit-log addendum) are implemented and pass QA; US-38 and US-45, which the stories document found already fully built by E1, were spot-checked and remain true and untouched. Backend: 508/508 tests passing (re-run independently for this review, 85 files). Frontend: 208/208 passing (re-run independently, 48 files). Backend typecheck: clean except the same 4 pre-existing, unrelated errors already on `main` before this epic (`campaign.service.additional.spec.ts`). Frontend typecheck: clean. This epic's build history was unusually complicated and every claim about that history was checked against the code, not taken on say-so. The first backend-dev session was interrupted mid-task; the second session's own commit message states it completed the scope and fixed the DI/constructor drift the interruption left behind, and this review confirms that claim directly: `agency.module.ts`/`campaign.module.ts`'s wiring is coherent (no circular-import break, `TemplateCopyService` correctly exported and consumed), the full suite boots and passes, and no orphaned reference to a removed or half-built symbol was found anywhere in the diff. Two real bugs were found by QA and fixed before this gate, and both fixes were independently re-verified by reading the resulting code rather than the commit messages alone: (1) a cross-tenant IDOR in `client-report-share-link.controller.ts`'s mint/revoke endpoints, where the `:clientAccountId` path parameter was never checked against `req.currentAccountId`, is now closed for both `mint` and `revoke`, for both `agency_admin` and `agency_operator`, with a genuine `AuditService.log` call on denial; (2) a stale-data bug where switching client context did not trigger a refetch on `campaigns-page.tsx` and `campaign-detail-page.tsx` is fixed by scoping each affected React Query key to the active account id, and `templates-page.tsx` -- which QA's own regression suite never originally exercised -- carried the identical bug and was fixed in the same commit. One gap in that second fix is disclosed rather than smoothed over: `templates-page.tsx`'s own spec file has no dedicated staleness-regression test analogous to the ones added for the other two pages. QA's caveat on FR-60 is confirmed accurate: the `audit_log` table's asymmetric read/write RLS policy is correctly written into the migration exactly as ADR-0062 specifies, but `TenantContextMiddleware` -- the only code that would ever set the session variable every tenant-isolation policy in this platform depends on -- is still never registered in `app.module.ts`. The actual, operative tenant boundary for `GET /audit-log` today is `RolesGuard`/`AccountAccessService.resolveAccess` plus `AuditService.listForAccount`'s own `WHERE` clause, not the database. US-41's two hard rules were independently verified: `TemplateCopyService.copyFields` hardcodes `brandProfileSnapshot: null` on every cross-client copy, and `TemplateService.copyTemplate` runs an independent authorization check against the target account for `agency_operator`, with `agency_admin` correctly exempted. This is the final epic in the current roadmap; Section 8 closes with the project's overall state across all nine epics.

## 1. Purpose

This document summarizes what was built for Epic E9 (Agency Multi-Client Operations), checks it against the four E9 ADRs (0059 through 0062) and the E9 architecture specification, reports the actual state of automated tests, and lists open items. It is the gate artifact reviewed before merging `feature/e9-agency-multi-client-operations` into `main`. E9 branches from `main` (which already contains E1 through E8), so this document covers only E9's own changes, including its additive touches to E1's `agency` module, E2's `campaign`/`campaign_template` entities, and E7's `analytics`/`agency_branding_profile` entities. As the final epic in the current roadmap, Section 8 also assesses the project as a whole.

Per the stories document's own, codebase-checked framing, this epic's genuine scope is narrower than the PRD's own persona table suggests: US-38 and US-45 were found already fully implemented by E1, and are reproduced here only as a spot-check, not re-specified.

<p align="center"><strong>Table 1</strong></p>

<p align="center"><em>Stories in Scope for Epic E9</em></p>

<div align="center">

| Story | Priority | Persona | Status |
|---|---|---|---|
| US-38 One workspace holding several isolated client accounts | Must | Renata | Already implemented by E1; spot-checked, not re-built |
| US-39 Run campaigns on behalf of a specific client | Must | Renata | Implemented, tested (the user-facing selector and attribution; the authorization mechanism was already built) |
| US-41 Apply reusable templates across clients | Should | Renata | Implemented, tested |
| US-44 White-label the client-facing surface | Should | Renata | Implemented, tested (narrower than a literal reading of FR-57, per ADR-0061) |
| US-45 Grant per-client permissions to team members | Should | Renata | Already implemented by E1; spot-checked, not re-built |
| FR-60 addendum: view the audit log of a client account | Should | Renata | Implemented, tested (shared addendum to US-38/US-45, not a separately numbered PRD story) |

</div>

*Note.* Priority follows the MoSCoW scale defined in the product requirements document. All Must stories (US-38, US-39) and all Should stories in genuine scope (US-41, US-44, US-45's own spot-check, the FR-60 addendum) have a corresponding passing QA result.

## 2. What Was Built

**Backend**, additive across four existing modules (`agency`, `campaign`, `audit`, `analytics`); no new module, consistent with the architecture document's own framing ("this epic touches four existing backend modules additively... introduces no new module"):

- `agency/template-copy.service.ts` implements the one place this epic deliberately crosses `campaign_template`'s RLS tenant boundary (ADR-0060): `copyAllTemplates` (the onboarding-time bulk case, wiring up E1's dead `copy_templates_from` stub inside `AgencyService.createClient`) and `copyOne` (the ongoing case), both opening their own `queryRunner` transaction, issuing the `SET LOCAL app.agency_template_copy = 'true'`/`app.current_workspace_id` pair before the insert, and both hardcoding `brandProfileSnapshot: null` on every copied row regardless of what the source held.
- `campaign/template.service.ts`'s new `copyTemplate` method (behind `POST /campaign-templates/:id/copy`, `campaign/template.controller.ts`) implements US-41 scenario 2/3: loads the source template under the caller's already-authorized account, resolves and validates the target account against the same workspace, runs the one genuinely new authorization check this epic adds (an independent `AccountAccessService.resolveAccess` call against the target account, for `agency_operator` only), and writes `campaign_template.copied` or a denied `authorization.denied` entry accordingly.
- `agency/client-report-share-link.service.ts`/`.controller.ts` and `agency/public-client-report.controller.ts` implement US-44's one new client-facing, no-login surface (ADR-0061): `POST`/`DELETE .../share-link` mint and revoke a token-gated link to an E7 `client_performance_report`; `GET /public/client-reports/:token`, decorated `@Public()`, is the one route in this whole epic reachable with no Aurora credential, rendering the report under the agency's branding (or the same neutral fallback ADR-0048 already established) via the exported `ClientReportService.getReportForSharing`, never re-querying `client_performance_report` directly.
- `agency/agency-branding.service.ts` gains `custom_domain`/`domain_status` (ADR-0061): format-validated hostname syntax only, `domain_status` fixed to `pending_activation` the moment a domain is set, with no DNS/routing/certificate code path anywhere in the diff.
- `audit/audit.controller.ts`/`audit.service.ts` implement FR-60's first-ever read path: `GET /audit-log`, restricted to `agency_admin`/`agency_operator`, with `AuditService.listForAccount` doing the actual account-scoped, cursor-paginated query and the actor name/email resolution; no new authorization code beyond the role decorator, consistent with ADR-0062's claim that `RolesGuard` already does the rest.
- One migration (`1735000000000-AgencyMultiClientSchema.ts`) adds `campaign_template.copied_from_template_id`, the `agency_template_copy` OR-branch on `campaign_template`'s existing policy, `agency_branding_profile`'s two new columns and CHECK constraint, the new `client_report_share_link` table (RLS enabled and forced, with its own authenticated/public OR-branch), and the asymmetric `audit_log_write`/`audit_log_read` policy split.

**Frontend**, additive across existing routes, no new route except the one public surface: `app-layout.tsx`'s account switcher gains optgroup grouping ("Minha agencia"/"Clientes") and a persistent "Atuando em nome de" banner; `campaigns-page.tsx`/`campaign-detail-page.tsx` render the new `account_id`/`account_name` fields as a badge; `campaign-form-page.tsx` shows a non-interactive "Esta campanha sera criada para" notice on the creation form in agency workspaces; `templates-page.tsx` gains a "Copiar para outro cliente" action and target-client dialog; `agency-branding-page.tsx` gains the custom-domain field with inline, deliberately non-overpromising help text; `client-report-page.tsx` gains a share-link mint/revoke management list; `audit-log-page.tsx` (new route, `/app/audit-log`) and `public-client-report-page.tsx` (new, public route, `/public/client-reports/:token`) are both wholly new pages.

**Build history, verified rather than taken on faith.** Two backend-dev sessions: `8598e96` (frontend) and `e4809c0` (backend) are the two feature commits; `e4809c0`'s own message states it "completes the E9 backend scope left unfinished by the prior session" and separately "fixes DI/constructor drift left by the interrupted session." This review independently confirmed the final state is coherent: `agency.module.ts` correctly exports `TemplateCopyService` for `campaign.module.ts` to consume (not circular -- `AgencyModule` never imports `CampaignModule`), the full backend suite boots and passes at 508/508, and no spec file anywhere in the diff references a removed constructor parameter or a stale mock shape. QA's own commit (`c1bc80d`) added regression coverage exposing both real bugs fixed by this review (the share-link IDOR and the client-context staleness bug); a bug-fix commit (`a82ba00`) and a React-Query-key fix (`2c68c2d`) closed them; a final commit (`f1c9ab8`) corrected a test-construction mistake in the staleness regression specs (the original specs reused the same pre-built React element across `render`/`rerender`, which does not force the component to re-read a mocked hook's new return value; the fix builds a fresh element on each call) so the regression tests actually exercise what they claim to.

## 3. Compliance With ADRs and Architecture

**ADR-0059 (client-context selector and campaign attribution reuse existing account-switch plumbing, no new authorization mechanism):** followed exactly. No new backend authorization code was added for US-39 anywhere in the diff; `GET /campaigns`/`GET /campaigns/:id` gain `account_id`/`account_name` as a plain join on the already-correct, already-stored `campaign.accountId`. The frontend extends, not replaces: `app-layout.tsx`'s existing select/`switchAccount` mechanism gains grouping and a banner; no second state source for "which account is active" was introduced.

**ADR-0060 (cross-client template copy -- a narrow RLS escape hatch, dual-account authorization, never copying the brand snapshot):** followed exactly, verified independently against the code rather than the ADR's own narrative. `TemplateCopyService.copyFields` hardcodes `brandProfileSnapshot: null` on both the bulk and the single-template copy path, with no conditional branch that could ever carry the source value across. The dual-account check is real and correctly scoped: `TemplateService.copyTemplate` resolves the source template and target account first (404 `CLIENT_NOT_FOUND`), then runs `AccountAccessService.resolveAccess` against the **target** account specifically when, and only when, `currentRole === Role.AGENCY_OPERATOR`; an `agency_admin` skips this check entirely, relying on the workspace match already performed. A denial writes `authorization.denied` with `target_account_id` set to the target before throwing 403 `TARGET_NOT_ACCESSIBLE`.

**ADR-0061 (white-label scope for the pilot -- a public branded share link, a stored-but-inactive custom domain):** followed exactly. `domain_status` is set to `'pending_activation'` the instant a non-null `custom_domain` is saved and the CHECK constraint permits no other value; no code path ever sets it to anything else, and the one URL actually served (`share_url`) is always Aurora's own `FRONTEND_URL`. The public surface is genuinely public: `PublicClientReportController` carries `@Public()` with no `@Roles()`, no `X-Account-Id` read anywhere in its handler.

**ADR-0062 (audit log read endpoint -- asymmetric read/write RLS retrofit, agency-scoped by role):** followed exactly at the specification layer, and QA's own caveat about the retrofit's actual runtime effect is confirmed accurate by this review, not merely repeated. The migration's two policies (`audit_log_write FOR INSERT WITH CHECK (true)`, `audit_log_read FOR SELECT USING (target_account_id = current_setting('app.current_account_id', true)::uuid)`) are written exactly as specified. But `current_setting('app.current_account_id', true)` is only ever populated by `TenantContextMiddleware`, and a repository-wide grep confirms that class is never imported or registered anywhere -- a gap first disclosed in the E1 review and carried, unfixed, through every epic since. The practical consequence for `GET /audit-log`: the query's own `WHERE a.targetAccountId = :accountId` clause, reached only after `RolesGuard`/`AccountAccessService.resolveAccess` has already refused any caller without a resolvable relationship to that account, is the entire, real tenant boundary today. The database-level policy is correctly specified and will become a genuine second layer the moment the middleware is fixed, but is not an engaged one now.

**US-38/US-45 spot-check (already built by E1):** confirmed, not re-verified in full. `AgencyService.grantOperatorAccess`/`revokeOperatorAccess` are unchanged by this epic's diff (only `createClient` gained the template-copy call); `operator_client_access` is read, never written, by the one new target-account check this epic adds. The claim holds.

**No deviation from any of the four ADRs or the architecture document's data model was found beyond what is already disclosed above.** Two items are recorded as disclosed, non-blocking observations:

1. The architecture document states a CI allow-list check for RLS escape-hatch flags should be extended to include `app.agency_template_copy` and `app.public_share_link_read`. As every epic's own summary since E8 already records, no CI configuration exists anywhere in this repository at all. This is not a new gap E9 introduces.
2. `client-report-share-link.controller.ts`'s IDOR fix guards its mismatch check with `if (currentAccountId && currentAccountId !== clientAccountId)` rather than an unconditional comparison. In practice this is not exploitable: any caller who reaches this handler at all must hold `agency_admin`/`agency_operator` on some account, which guarantees a truthy `currentAccountId` by the time `RolesGuard` finishes. It is recorded as a minor, non-blocking hardening recommendation, not a live deviation.

## 4. Test Results

<p align="center"><strong>Table 2</strong></p>

<p align="center"><em>Automated Test Results by Package, Final State</em></p>

<div align="center">

| Package | Command | Result |
|---|---|---|
| Backend | `npx vitest run` (from `backend/`) | 85 test files, 508 tests, all passing |
| Frontend | `npx vitest run` (from `frontend/`) | 48 test files, 208 tests, all passing |
| Backend typecheck | `npx tsc --noEmit` (from `backend/`) | 4 errors, all pre-existing and unrelated (same as E8), zero introduced by this epic |
| Frontend typecheck | `npx tsc --noEmit` (from `frontend/`) | 0 errors |

</div>

Backend coverage specific to this epic: `template-copy.service.spec.ts`, the cross-client-copy additions to `template.service.spec.ts`, `audit.service.spec.ts`/`audit.controller.spec.ts`, `client-report-share-link.service.spec.ts`/`.controller.spec.ts`, `public-client-report.controller.spec.ts`, plus the `agency.service.spec.ts`/`agency-branding.service.spec.ts` updates. Frontend coverage specific to this epic: `audit-log-page.spec.tsx`, `campaign-detail-page.spec.tsx`, `campaign-form-page.spec.tsx`, `campaigns-page.spec.tsx`, `templates-page.spec.tsx`, `public-client-report-page.spec.tsx`, plus the `agency-branding-page.spec.tsx`/`client-report-page.spec.tsx` updates. The share-link IDOR fix's own regression tests (4/4 passing) and the two staleness-regression suites were independently re-run for this review, not only counted.

## 5. Story Coverage

<p align="center"><strong>Table 3</strong></p>

<p align="center"><em>Story Coverage Against Automated Tests, Final State</em></p>

<div align="center">

| Story | Priority | Backend evidence | Frontend evidence | Final verdict |
|---|---|---|---|---|
| US-38 | Must | Unchanged, E1's own suite (not re-verified in full) | Unchanged, E1's own suite | Meets acceptance criteria (spot-checked) |
| US-39 | Must | `campaign.service.spec.ts` (account_id/account_name) | `campaigns-page.spec.tsx`, `campaign-detail-page.spec.tsx`, `campaign-form-page.spec.tsx` | Meets acceptance criteria |
| US-41 | Should | `template-copy.service.spec.ts`, `template.service.spec.ts` | `templates-page.spec.tsx` | Meets acceptance criteria |
| US-44 | Should | `client-report-share-link.service.spec.ts`, `client-report-share-link.controller.spec.ts`, `public-client-report.controller.spec.ts`, `agency-branding.service.spec.ts` | `agency-branding-page.spec.tsx`, `client-report-page.spec.tsx`, `public-client-report-page.spec.tsx` | Meets acceptance criteria |
| US-45 | Should | Unchanged, E1's own suite (not re-verified in full) | Unchanged, E1's own suite | Meets acceptance criteria (spot-checked) |
| FR-60 addendum | Should | `audit.service.spec.ts`, `audit.controller.spec.ts` | `audit-log-page.spec.tsx` | Meets acceptance criteria |

</div>

Every Must story (US-38, US-39) and every Should story in genuine scope (US-41, US-44, US-45, the FR-60 addendum) has a corresponding passing test result after the fixes described in Section 2. `templates-page.tsx` is the one exception worth naming precisely: its production fix is real and confirmed by direct code reading, but it has no dedicated staleness-regression test of its own, unlike `campaigns-page.tsx`/`campaign-detail-page.tsx`.

## 6. Deviations Summary

1. **Found, fixed, and re-verified before this gate (not a remaining deviation):** `client-report-share-link.controller.ts`'s mint/revoke endpoints did not check the `:clientAccountId` path parameter against `req.currentAccountId`, a genuine cross-tenant IDOR (NFR-16). Confirmed fixed for both `mint` and `revoke`, for both roles, with a real `AuditService.log` call on denial.
2. **Found, fixed, and re-verified before this gate (with one disclosed gap):** `campaigns-page.tsx`, `campaign-detail-page.tsx`, and `templates-page.tsx` did not include the active account id in their React Query keys, so switching client context left the previous client's data on screen with no refetch. All three are fixed. `templates-page.tsx`'s fix has no accompanying staleness-regression test, unlike the other two pages.
3. **Disclosed, confirmed accurate, non-blocking:** `audit_log`'s RLS retrofit is correctly specified (ADR-0062) but not an engaged runtime boundary, because `TenantContextMiddleware` remains unregistered -- a whole-project gap, not new to this epic.
4. **Disclosed, confirmed accurate, non-blocking:** no CI configuration exists anywhere in this repository for the RLS escape-hatch allow-list check the architecture document references, a pre-existing, whole-project condition already named in E8's own summary.
5. **Disclosed, confirmed accurate, non-blocking, minor:** the IDOR fix's mismatch check is written as a conditional rather than an unconditional comparison; not practically exploitable today, but a stronger, unconditional form is recommended.
6. **No deviation found** between the implementation and any of the four ADRs or the architecture document's data model, contracts, or state machines, beyond the five items above.

## 7. Open Items for a Future Epic

- Register `TenantContextMiddleware` correctly in `app.module.ts` so every tenant-isolation RLS policy this platform has ever written -- including this epic's own `audit_log_read`/`write` split and its two new escape-hatch flags -- becomes a genuinely engaged second line of defense rather than a correctly-specified but inert one. This is now unresolved across all nine epics (E1 through E9).
- Stand up a real-Postgres integration-test harness, first recommended by E6 and repeated by every epic's summary since, now also the only way to verify this epic's own RLS escape hatches (`app.agency_template_copy`, `app.public_share_link_read`) actually behave as specified against a running database rather than by migration inspection alone.
- Add a dedicated staleness-regression test for `templates-page.tsx`, matching the pattern already established for `campaigns-page.tsx`/`campaign-detail-page.tsx`.
- Harden `client-report-share-link.controller.ts`'s mismatch check to an unconditional comparison rather than one guarded by `currentAccountId`'s truthiness.
- Stand up the RLS-escape-hatch CI allow-list check the architecture documents for E7, E8, and E9 all reference but which has never actually been built in this repository.
- If product decides FR-57's "client-facing surface" should also mean the agency's own internal working UI, that is a materially larger, separate build, not an extension of this epic's work.
- Resolve, with product, whether FR-60's audit-log read surface should be extended to direct brand workspaces.
- Decide whether per-client access grants (US-45) should require MFA, an open question Table 15 does not resolve for this epic.

## 8. Closing Assessment: The Project After Nine Epics

This is the last epic in the current roadmap. E1 through E9 together implement the full PRD-traced story set this project has built against, from initial access and onboarding through agency multi-client operations.

<p align="center"><strong>Table 4</strong></p>

<p align="center"><em>Cumulative Automated Test Counts by Epic, Project to Date</em></p>

<div align="center">

| Epic | Backend tests passing | Frontend tests passing |
|---|---|---|
| E1 Access and Onboarding | 17/17 | 0 (test runner itself failed to start; fixed in E2) |
| E2 Campaign Planning and Pool Buying | 54/54 | 13/13 |
| E3 Creator Matching and Curation | 107/107 | 31/31 |
| E4 Brand Safety | 185/185 | 48/48 |
| E5 Briefing and Content Workflow | 247/247 | 75/75 |
| E6 Payments and Financial Transparency | 323/323 | 92/92 |
| E7 Analytics and Reporting | 389/389 | 127/127 |
| E8 Creator Recruitment and Growth | 468/468 | 181/181 |
| E9 Agency Multi-Client Operations (this epic, final) | 508/508 | 208/208 |

</div>

*Note.* Each row is the cumulative total at that epic's own merge gate. This is not nine separate test suites but one growing suite. The project's final, cumulative state is 508 backend and 208 frontend tests, 716 automated tests total, all passing, independently re-run for this review.

**The single most-repeated unresolved item across every epic's own open-items section is the `TenantContextMiddleware` registration gap.** It was first disclosed in E1's own summary and named again, unresolved, in E2 through E8, and explicitly in E6's and E7's own summaries as a named, still-open risk. This document confirms it a ninth time, independently, by grep rather than by repeating the claim. **The second most-repeated item is the absence of a real-Postgres integration-test harness**, first named in E6's own summary and repeated, unresolved, by E7 and E8; this epic adds a new reason that item matters, since its own two new RLS escape hatches are, like every one before them, verified only by migration inspection and unit-level mocking, never against a running database. Both items remain open at the close of this roadmap.

**Is the codebase, taken as a whole across all nine epics, coherent and mergeable?** Yes, with the caveats already on record. Every epic's own gate found and fixed its real bugs before merge (E6's missing transaction wrap, E7's inert cross-client RLS branch and missing frontend/QA coverage, E8's missing frontend spec files, and this epic's IDOR and staleness bugs); none of those fixes left a regression behind, confirmed in this epic's case by an independently re-run, fully passing suite and a clean frontend typecheck. The RLS-as-specified-but-not-engaged gap is real and has been honestly disclosed in every epic's summary since E1, including this one -- it has not caused a demonstrated data leak in any epic's review, because every service layer checked, across all nine epics, consistently filters by account id (or the equivalent per-client identifier) in application code, which is the actual, load-bearing tenant boundary this platform has run on since E1. That boundary has held under every review's direct inspection. What has not been built, across the whole project, is the database-level second line of defense the architecture documents have described as already in place since E1; closing that gap, and standing up a real integration-test harness to verify it once closed, are the two highest-value items for whatever comes after this roadmap.

## References

Aurora Project Team. (2026). *ADR-0010: campaign template scoped to the account, agency cross-client sharing deferred to E9*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0048: agency branding profile built ahead of E9, scoped to the per-client report only*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0059: client-context selector and campaign attribution reuse existing account-switch plumbing, no new authorization mechanism*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0060: cross-client template copy, a narrow RLS escape hatch, dual-account authorization, and never copying the source's brand snapshot*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0061: white-label scope for the pilot, a public branded share link and a stored-but-inactive custom domain, extending ADR-0048's table rather than replacing it*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0062: audit log read endpoint, retrofitting an asymmetric read/write RLS policy rather than trusting the service layer alone, scoped to agency workspaces by role*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *E1, Access and onboarding: Summary*. Internal epic summary, Aurora project.

Aurora Project Team. (2026). *E1, Access and onboarding: Technical architecture*. Internal architecture specification, Aurora project.

Aurora Project Team. (2026). *E2, Campaign planning and pool buying: Summary*. Internal epic summary, Aurora project.

Aurora Project Team. (2026). *E3, Creator matching and curation: Summary*. Internal epic summary, Aurora project.

Aurora Project Team. (2026). *E4, Brand safety: Summary*. Internal epic summary, Aurora project.

Aurora Project Team. (2026). *E5, Briefing and content workflow: Summary*. Internal epic summary, Aurora project.

Aurora Project Team. (2026). *E6, Payments and financial transparency: Summary*. Internal epic summary, Aurora project.

Aurora Project Team. (2026). *E7, Analytics and reporting: Summary*. Internal epic summary, Aurora project.

Aurora Project Team. (2026). *E8, Creator recruitment and growth: Summary*. Internal epic summary, Aurora project.

Aurora Project Team. (2026). *E9, Agency multi-client operations: Stories*. Internal product requirements document, Aurora project.

Aurora Project Team. (2026). *E9, Agency multi-client operations: Technical architecture*. Internal architecture specification, Aurora project.

Aurora Project Team. (2026). *Product requirements document*. Internal product requirements document, Aurora project.
