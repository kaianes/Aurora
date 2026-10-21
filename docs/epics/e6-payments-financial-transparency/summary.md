# Epic E6, Payments and Financial Transparency: Summary

**Author:** Kaiane Cordeiro. Aurora Project, Sprint 8. **Date:** October 21, 2026.

> **TL;DR.** All seven Must stories (US-29, US-35a, US-35b, US-35c, US-36a, US-20, US-42) and the one Should story (US-36b) are implemented, tested, and pending merge. Backend: 323/323 tests passing. Frontend: 92/92 passing. The money-safety properties this review focused on hold: `payout_gross`/`commission`/`net` are copied verbatim from `campaign_opportunity` and never recomputed (ADR-0036); the only path to a `settled` obligation in this pilot is the MFA-gated `aurora_operator` manual endpoint, with the stub adapter's `checkStatus` always returning `pending` and no code path reaching any live payment processor (ADR-0033, ADR-0038); `ledger_entry` writes are single-writer, always balanced, and append-only by trigger (ADR-0037); and obligation-creation idempotency on `content_submission_id` holds under a genuine concurrent-insert race. **One real deviation was found during review and has since been fixed.** ADR-0036 and the architecture document both asserted, as a built fact, that the payout obligation is created "in the same ACID transaction" as E5's publication-confirmation write, with no window in which a publication could be confirmed with no obligation to show for it. The first implementation did not actually wrap these writes in a database transaction. This was caught before merge, fixed by wrapping `PublicationService.confirmPublication`'s submission save and `PayoutObligationService.createForConfirmedPublication` in one `dataSource.transaction()` call, and re-verified: the full suite passes at 323/323 (320 baseline plus 3 tests covering the new transactional path, including a rollback case), and this document's author independently read the fixed code to confirm the two writes now commit or roll back together. One small, pre-existing nuance remains and is recorded as an open item rather than re-opened as a blocker: `BrandSafetyGateService.recordPublication`'s own write (a monitoring snapshot, not a financial record) still runs on its own connection rather than inside the shared transaction, since it was not changed to accept a transaction manager; this does not reintroduce the lost-payout-obligation risk the fix was for, since content_submission.published_at is rolled back together with the obligation if anything downstream fails, but it means a crash in that narrow window can leave an orphaned safety-monitoring snapshot with no corresponding published submission. A second, unrelated typecheck regression (RxJS `Observer` typing in a QA-authored spec file) was also found and fixed before this summary was written. QA's own epic-wide finding is confirmed by this review: no integration-test harness with a real Postgres instance exists anywhere in this repository (E1 through E6), so the database-enforced invariants this epic depends on most -- the payout-figure-immutability trigger, the two append-only triggers, and the new RLS policies -- are correct by direct inspection of the migration but were not exercised against a running database in this sandbox.

## 1. Purpose

This document summarizes what was built for Epic E6 (Payments and Financial Transparency), checks it against the eleven E6 ADRs (0033 through 0043) and the E6 architecture specification, reports the actual state of automated tests, and lists open items. It is the gate artifact reviewed before merging `feature/e6-payments-financial-transparency` into `main`. E6 branches from `main` (which already contains E1 through E5), so this review's diff covers only E6's own changes, including its small, additive touches to E3's `matching` module and E5's `content-workflow` module.

<p align="center"><strong>Table 1</strong></p>

<p align="center"><em>Stories in Scope for Epic E6</em></p>

<div align="center">

| Story | Priority | Persona | Status |
|---|---|---|---|
| US-29 See Gross, Commission, and Net Payout Before Accepting | Must | Duda | Implemented, tested |
| US-35a Create a Payout Obligation When Publication Is Confirmed and Approved | Must | Duda | Implemented, tested |
| US-35b Execute the Payout Within the Committed Window | Must | Duda | Implemented, tested |
| US-35c Notify Duda Within 24 Hours When a Payout Fails | Must | Duda | Implemented, tested |
| US-36a See Full Payment History and Downloadable Statements | Must | Duda | Implemented, tested |
| US-36b Generate Tax Documentation for Creator Payouts | Should | Duda | Implemented, tested |
| US-20 One Consolidated Invoice Covering the Whole Pool | Must | Marina | Implemented, tested |
| US-42 Consolidated Per-Client Billing with Aurora Paying the Creators | Must | Renata | Implemented, tested |

</div>

*Note.* Priority follows the MoSCoW scale defined in the product requirements document, confirmed against `docs/epics/e6-payments-financial-transparency/stories.md`. US-35a/US-35b/US-35c are sub-stories of US-35; US-36a/US-36b are sub-stories of US-36; each carries its own acceptance criteria and governing ADR(s), consistent with the precedent E5 set for its own sub-stories.

## 2. What Was Built

**Backend** (`backend/src/payments`): one new NestJS module, `payments`, covering all eight stories, plus two small, additive wiring changes to modules this epic does not own. `payout-obligation.service.ts` implements US-35a (creation, keyed off E5's `publication_confirmed` hand-off, idempotent on `content_submission_id` including under a genuine insert race), the write side of US-35b/US-35c, and the read side of US-36a. `ledger.service.ts` exposes exactly one write method, `recordBalancedEntry`, which always writes a debit and a credit leg of equal amount inside one transaction. `adapters/payout-execution.adapter.ts` defines `PayoutExecutionAdapter` and ships `StubPayoutExecutionAdapter`, whose `executeTransfer` always reports `instructed` with no network call and whose `checkStatus` always reports `pending`. `adapters/payout-notification.adapter.ts` defines a notification port independent of E5's `BriefingNotificationAdapter`. `operator-auth.guard.ts` implements the `aurora_operator` principal: it re-reads `user.is_aurora_operator` from the database rather than trusting a JWT claim, and unconditionally requires MFA before either manual-settlement endpoint can be called. `ops-payout.controller.ts` exposes the two manual-fallback endpoints and a cross-tenant reconciliation list, behind `OperatorAuthGuard`. `creator-portal-payout.controller.ts` and `invoice.controller.ts` expose the creator-facing and brand/agency-facing read surfaces. `tax-document.service.ts` implements US-36b: generated on settlement, idempotent on `payout_obligation_id`, with an explicit `blocked_missing_info` state. `invoice.service.ts` implements US-20/US-42 with one shared schema and no buyer-type branching, per ADR-0040. `financial-access-audit.interceptor.ts` implements NFR-23's read-logging requirement as a reusable interceptor applied via an `@AuditResource` decorator -- the first epic in this codebase whose audit convention covers reads, not only writes. `attempt-payout-execution.processor.ts` and `payments-scheduled-tasks.service.ts` implement the background jobs section 5 of the architecture document specifies. One migration (`1720000000000-PaymentsSchema.ts`) creates the six new tables, their three immutability/append-only triggers, their RLS policies (including the new `app.aurora_operator` escape hatch), and additive extensions to `creator` and `user`.

The two changes to modules this epic does not own: (1) `content-workflow.module.ts` imports the new `PaymentsModule`, and `PublicationService` gains an injected `PayoutObligationService` and `DataSource`, called from inside `confirmPublication`. (2) `matching/opportunity.service.ts`'s `listForCreator` and `accept` methods gain a computed, read-only `expected_payment_date`/`expected_payment_date_is_estimate` pair, computed from `COALESCE(campaign.timeline_end, opportunity.expires_at) + PAYOUT_WINDOW_DAYS`, touching no column on `campaign_opportunity` itself.

**Frontend** (`frontend/src`): implements the route map from architecture section 6. `/creator-portal/opportunities/:id` (E3's existing opportunity view, extended with the projected-date field, visually muted and labeled as an estimate). `/creator-portal/payments` and `/creator-portal/payments/:id` implement US-36a's history list and per-obligation detail, including execution-attempt history and tax-document status. `/app/campaigns/:id/invoice` implements US-20/US-42's generate/view action, surfacing `CAMPAIGN_NOT_BILLABLE`'s pending-opportunity count inline.

**QA round.** QA reported PASS on all eight stories, 320/320 backend tests and 92/92 frontend tests at the time, with zero implementation bugs found, and added ten new or extended spec files. This review independently re-ran both suites and confirmed QA's totals, then went further: it read the specific test claimed to exercise the race-condition idempotency guarantee and confirmed it genuinely simulates a Postgres `23505` unique-violation and verifies recovery rather than error propagation; and it independently traced `confirmPublication`'s actual write pattern against ADR-0036's transactional claim, which is where the one real deviation surfaced (Section 3).

## 3. Compliance With ADRs and Architecture

**ADR-0033 (Payout Execution Isolated Behind a `PayoutExecutionAdapter`, Stub Only in This Pilot):** followed exactly. `StubPayoutExecutionAdapter.executeTransfer` always returns `instructed` with no network call; `checkStatus` always returns `pending`. The only code path that sets `status = settled` is `applySettlement`, reachable only from `markSettledManually` (MFA-gated) or `settleFromPoll` (which never fires given the stub). No code path from any creator- or brand-facing endpoint reaches a live or simulated payment processor.

**ADR-0034 (A Configurable Five-Day Payout Window Default):** followed exactly. `PAYOUT_WINDOW_DAYS` defaults to 5 and is shared between the pre-acceptance projection in `opportunity.service.ts` and the binding deadline in `payout-obligation.service.ts`, so the two computations cannot drift to different window lengths.

**ADR-0035 (Expected Payment Date Is a Projection):** followed exactly. The field is always flagged `expected_payment_date_is_estimate: true`, with no code path that could set it `false`, and the frontend renders it with visibly lower weight than the three locked payout figures.

**ADR-0036 (Payout Obligation Creation Wired via an Exported Service):** the wiring pattern is followed exactly: `content-workflow.module.ts` imports `PaymentsModule`; `confirmPublication` calls `PayoutObligationService.createForConfirmedPublication` with the correct call-site ordering; the method is idempotent by construction (`UNIQUE(content_submission_id)` plus a `23505`-catch fallback) and defensively re-checks only `publishedAt` and `campaign_opportunity.status`, never reaching into `content_review_decision`. **A deviation was found and has been fixed.** The ADR's and architecture document's claim that "the obligation is created in the same ACID transaction as the publication confirmation itself" was false in the first implementation: `confirmPublication` performed its writes with no transaction wrapper, so a crash between the submission save and the obligation insert could have left a publication confirmed with no obligation and nothing to ever notice. This review flagged it as a genuine NFR-13 risk, not a documentation nit, since ADR-0036's own risk section explicitly reasons about this exact failure mode when rejecting an alternative design. The fix (commit `220d197`): `PublicationService` now injects a `DataSource`, and wraps the submission save and the payout-obligation creation in one `dataSource.transaction()` call, with `PayoutObligationService.createForConfirmedPublication` extended to accept an optional `EntityManager` so it participates in the caller's transaction (confirmed by this review reading the resulting code directly: `manager.save(ContentSubmission, submission)` and the obligation service call both execute against the same `manager`). The audit log write is deliberately left outside the transaction (losing an audit entry is a lesser severity than losing a financial obligation, and `audit_log` is best-effort elsewhere in this codebase too). This review re-ran the full suite after the fix (323/323 passing, including a new test asserting a failure inside the transaction rolls back before the audit log is reached) and independently re-read the fixed code rather than taking the fix on faith. **One smaller nuance was found in the fix itself and is recorded as an open item, not as a reopened blocker:** `BrandSafetyGateService.recordPublication` is also called inside the new transaction block, but it was not changed to accept a transaction manager, so its own write (a `published_content_snapshot` row, a safety-monitoring record, not a financial one) still executes against its own independently-committing repository. If `createForConfirmedPublication` were to throw after `recordPublication` has already committed, the outer transaction rolls back the submission save (so `published_at` is not persisted, meaning no lost payout obligation, which was the specific risk this fix targeted), but the safety-monitoring snapshot would remain committed for a submission that is not actually marked published. This is a narrower, lower-severity inconsistency than the one originally flagged, predates this fix, and does not reintroduce a financial-integrity gap, but it is not fully closed either.

**ADR-0037 (Ledger Entries as Balanced Pairs, Single Writer):** followed exactly. `LedgerService.recordBalancedEntry` is the only writer to `ledger_entry` anywhere in the codebase, confirmed by grep, and wraps both legs in one transaction. The `ledger_entry_immutable` trigger makes a direct update or delete impossible regardless.

**ADR-0038 (An `aurora_operator` Principal for Manual Settlement):** followed exactly. `is_aurora_operator` is additive and default-false with no grant endpoint in this epic's API surface. `OperatorAuthGuard` re-reads the user row and unconditionally requires MFA. As ADR-0038 itself discloses, the actual session-level setting of the `app.aurora_operator` RLS flag was not traced end-to-end against a running Postgres instance, for the same reason given in the TL;DR.

**ADR-0039/0040 (Invoice Generation and Shared Schema):** followed exactly. `InvoiceService.generate` enforces `CAMPAIGN_NOT_BILLABLE`/`INVOICE_ALREADY_GENERATED` preconditions with the same race-safety discipline used elsewhere in this epic, and contains no branch anywhere that distinguishes a direct-brand campaign from an agency-client one.

**ADR-0041/0042 (Tax Documentation and Statement Format):** followed exactly, with one disclosed, acknowledged simplification: statement/tax-document URLs are deterministic object-storage paths rather than a real PDF-rendering pipeline, mirroring E1's existing logo-upload stub precedent and consistent with this epic's own stated pilot scope.

**ADR-0043 (Payout Failure Notification Behind a Dedicated Adapter):** followed exactly. The notification adapter is a distinct interface from E5's briefing notification adapter, and an obligation's in-app visibility is set independently of whether the notification job has run.

**Database constraints and RLS:** confirmed via direct read of the migration: all three triggers and all six RLS policies match the architecture document's specified SQL, including the `app.aurora_operator` escape-hatch branch. As stated above, these were verified by migration inspection, not by an executed test against a running database, since no such harness exists in this repository for any epic.

**Money-figure immutability and the idempotency race (the two properties this review focused on hardest):** both confirmed. `createForConfirmedPublication` copies `payout_gross`/`commission`/`net` directly with no arithmetic anywhere in the method, and the `payout_obligation_figures_immutable` trigger blocks any later update to those columns. The idempotency test genuinely simulates a Postgres `23505` concurrent-insert race, not merely a simple sequential-redelivery case, and the service's `catch` block recovers from it correctly.

No other deviations between the implementation and the eleven ADRs or the architecture document's stated endpoint and data-model shapes were found.

## 4. Test Results

<p align="center"><strong>Table 2</strong></p>

<p align="center"><em>Automated Test Results by Package</em></p>

<div align="center">

| Package | Command | Result |
|---|---|---|
| Backend | `npx vitest run` (from `backend/`) | 50 test files, 323 tests, all passing |
| Frontend | `npx vitest run` (from `frontend/`) | 25 test files, 92 tests, all passing |
| Backend typecheck | `npx tsc --noEmit` (from `backend/`) | 4 pre-existing, unrelated errors only (campaign.service.additional.spec.ts, present on main before this epic); zero errors introduced by this epic after the RxJS typing fix |

</div>

Backend coverage specific to this epic includes `payout-obligation.service.spec.ts`, `ledger.service.spec.ts`, `operator-auth.guard.spec.ts`, `payments-scheduled-tasks.service.spec.ts`, `attempt-payout-execution.processor.spec.ts`, `notify-payout-failure.processor.spec.ts`, `invoice.service.spec.ts`, `tax-document.service.spec.ts`, `financial-access-audit.interceptor.spec.ts`, `adapters/payout-execution.adapter.spec.ts`, plus the extensions to E3's `opportunity.service.spec.ts` and E5's `publication.service.spec.ts` (the latter extended again by the transaction fix, including a new rollback test). Frontend coverage specific to this epic includes `invoice-page.spec.tsx`, `payments-page.spec.tsx`, `payment-detail-page.spec.tsx`, and the extension to `opportunities-page.spec.tsx`.

## 5. Story Coverage

<p align="center"><strong>Table 3</strong></p>

<p align="center"><em>Story Coverage Against Automated Tests and QA Results</em></p>

<div align="center">

| Story | Priority | Backend evidence | Frontend evidence | QA result | Final verdict |
|---|---|---|---|---|---|
| US-29 | Must | `opportunity.service.spec.ts` | `opportunities-page.spec.tsx` | PASS | Meets acceptance criteria |
| US-35a | Must | `payout-obligation.service.spec.ts` (creation, idempotency, race, transactional fix) | n/a (backend invariant) | PASS | Meets acceptance criteria |
| US-35b | Must | `attempt-payout-execution.processor.spec.ts`, `payments-scheduled-tasks.service.spec.ts` | `payment-detail-page.spec.tsx` | PASS | Meets acceptance criteria |
| US-35c | Must | `notify-payout-failure.processor.spec.ts` | `payments-page.spec.tsx`, `payment-detail-page.spec.tsx` | PASS | Meets acceptance criteria |
| US-36a | Must | `payout-obligation.service.spec.ts` | `payments-page.spec.tsx`, `payment-detail-page.spec.tsx` | PASS | Meets acceptance criteria |
| US-36b | Should | `tax-document.service.spec.ts` | `payment-detail-page.spec.tsx` | PASS | Meets acceptance criteria |
| US-20 | Must | `invoice.service.spec.ts` | `invoice-page.spec.tsx` | PASS | Meets acceptance criteria |
| US-42 | Must | `invoice.service.spec.ts`, `payout-obligation.service.spec.ts` | `invoice-page.spec.tsx` | PASS | Meets acceptance criteria |

</div>

All eight stories in scope (seven Must, one Should) have a corresponding passing QA result; none shipped without one.

## 6. Deviations Summary

1. **Deviation found and fixed before merge (Section 3, ADR-0036):** the "same ACID transaction" guarantee was not actually present in the first implementation. It was fixed by wrapping the submission save and payout-obligation creation in one database transaction, and this review independently re-verified the fix by reading the resulting code and re-running the full suite (323/323). One smaller, lower-severity nuance remains open: `BrandSafetyGateService.recordPublication`'s own write does not share the same transaction, which can leave an orphaned safety-monitoring snapshot (not a financial record) in a narrow failure window. See Section 7.
2. **Secondary issue found and fixed before merge:** a QA-authored spec file (`financial-access-audit.interceptor.spec.ts`) introduced five new TypeScript errors from an RxJS `Observer` typing mismatch. These were fixed directly (correcting `subscribe({ complete: resolve })` to `subscribe({ complete: () => resolve() })`) and re-verified: `tsc --noEmit` now shows only the four pre-existing, unrelated errors that were already present on `main` before this epic.
3. **Disclosed gap, confirmed by this review, pre-existing and epic-wide (not introduced by E6):** no integration-test harness with a real Postgres instance exists anywhere in this repository (E1 through E6). The database-enforced invariants this epic depends on most -- the payout-figure-immutability trigger, the two append-only triggers, and all six new RLS policies -- are correct by direct migration inspection but were never exercised against a running database in this sandbox. For a pilot whose only execution adapter is an explicit stub that moves no real money, this is acceptable to ship past this gate; it is not acceptable to carry into any release where a real `PayoutExecutionAdapter` is bound.
4. **Disclosed and unresolved, by design:** no commission formula, `aurora_operator` grant policy, campaign-pause interaction with an unsettled obligation, non-PDF statement export, non-Brazil tax jurisdiction, automatic invoice triggering, or treatment of Aurora's own float risk is addressed by this epic, consistent with the stories document's own open questions.

## 7. Open Items for the Next Epic

- Close the smaller remaining nuance in `confirmPublication`'s transaction: either give `BrandSafetyGateService.recordPublication` an optional transaction-manager parameter (mirroring the pattern just applied to `PayoutObligationService`), or accept the current narrow, documented risk explicitly as a lower-severity trade-off since it affects a monitoring snapshot rather than a financial record.
- Stand up a real-Postgres integration-test harness and use it, at minimum, to exercise the three money-safety triggers this epic adds plus every RLS policy back to E1, before any real `PayoutExecutionAdapter` implementation is bound. This is now the single largest latent-risk item carried across six epics.
- Bring the stories document's remaining open questions to product for a decision; none are resolved by this epic, by design.
- Build the real `PayoutExecutionAdapter` implementation (a Brazilian PSP/Pix integration) once product confirms the pilot has validated enough of the rest of the money path.
- Name a real policy for who holds `is_aurora_operator` and under what process; the mechanism exists, the governance does not.
- Register the tenant-context middleware correctly and add an RLS-coverage test; unresolved across six epics now (E1 through E6).

## References

Aurora Project Team. (2026). *ADR-0032: Extending and exporting ContentSubmissionService for direct in-process reuse by content-workflow*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0033: Payout execution isolated behind a PayoutExecutionAdapter, with only a stub/manual implementation in this pilot*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0034: A configurable five-day payout window default, fixed platform-wide*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0035: The pre-acceptance "expected payment date" is a projection, not the binding commitment*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0036: Payout obligation creation wired via an exported PayoutObligationService, called from E5's publication-confirmation transaction*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0037: Ledger entries written only as balanced debit/credit pairs by a single LedgerService*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0038: An aurora_operator principal, analogous to the creator-portal RLS escape hatch, for the manual payout fallback*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0039: Invoice generation is an explicit, precondition-gated action; FR-19 adjustments are itemized line items on the same document*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0040: One invoice schema serves both direct-brand (US-20) and agency-client (US-42) billing, with no agency-specific table*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0041: Tax documentation scoped to Brazil only, kept to one simple generated/blocked state, for this pilot*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0042: Payment statements are on-demand PDFs via object storage, not a stored database document*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0043: Payout failure notification behind a dedicated adapter, decoupled from in-app visibility*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *E3, Creator matching and curation: Technical architecture*. Internal architecture specification, Aurora project.

Aurora Project Team. (2026). *E5, Briefing and content workflow: Technical architecture*. Internal architecture specification, Aurora project.

Aurora Project Team. (2026). *E5, Briefing and content workflow: Summary*. Internal epic summary, Aurora project.

Aurora Project Team. (2026). *E6, Payments and financial transparency: Stories*. Internal product requirements document, Aurora project.

Aurora Project Team. (2026). *E6, Payments and financial transparency: Technical architecture*. Internal architecture specification, Aurora project.

Aurora Project Team. (2026). *Product requirements document*. Internal product requirements document, Aurora project.
