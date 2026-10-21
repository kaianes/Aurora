# Epic E8, Creator Recruitment and Growth: Summary

**Author:** Kaiane Cordeiro. Aurora Project, Sprint 10. **Date:** October 21, 2026.

> **TL;DR.** All nine stories (US-23.1, US-23.2, US-24.1, US-24.2, US-24.3, US-24.4, US-25, US-26, US-27) are implemented and pass QA. Backend: 468/468 tests passing (re-run independently for this review). Frontend: 181/181 passing (re-run independently). Backend typecheck: clean except the same 4 pre-existing, unrelated errors already on `main` before this epic (`campaign.service.additional.spec.ts`, unchanged by this epic's diff). Frontend typecheck: clean. Every deviation named in the review brief was checked directly against the code, not taken on a prior agent's word, and every one of them held up: the E3 stub login is genuinely removed (route, handler, and its `JwtModule`/`ConfigModule` wiring all gone from `matching.module.ts`), and `creator-network`'s registration, login, and claim-confirm flows call `AuthService.createUser`/`verifyEmailToken`/`authenticateCredentials` directly rather than reimplementing password hashing or token logic. US-24.4's qualification decision writes `creator.status`/`creator.onboardingStatus` using the identical enum imported from `../database/entities` that `real-matching-engine.adapter.ts` and `shortlist.service.ts` already read (`CreatorStatus.ACTIVE`, `CreatorOnboardingStatus.QUALIFIED`), confirmed by reading both sides, not by grep alone. US-23.2's FK policy is exactly as described: `creator_invitation.creator_id` is nullable with `ON DELETE SET NULL` (a declined invitation's own row survives its creator's deletion), while the 90-day `expire-unclaimed-profiles` job explicitly deletes every `creator_invitation` row for that creator before deleting the creator itself, rather than relying on a cascade it does not have. OAuth tokens are genuinely AES-256-GCM envelope-encrypted (`TokenCipherService`, no plaintext token column anywhere in `creator_social_account`), and all three new adapters (`SocialAuthAdapter`, `CreatorAudienceInsightsAdapter`, `AuthenticityScoringAdapter`) are stub-only with zero network calls, consistent with every other external-integration point in this codebase. One real process observation, not a code defect, is recorded rather than smoothed over: frontend-dev's own commit added ten new creator-portal pages and zero spec files, a break from this project's pattern in every prior epic; QA's follow-up commit closed that gap completely (10 new frontend spec files, all passing) and separately added one backend spec file closing a coverage gap on `AuthService`'s three new exported methods. No implementation deviation from the ten ADRs (0049 through 0058) or the architecture document was found beyond minor, already-disclosed, non-blocking notes recorded in Section 3.

## 1. Purpose

This document summarizes what was built for Epic E8 (Creator Recruitment and Growth), checks it against the ten E8 ADRs (0049 through 0058) and the E8 architecture specification, reports the actual state of automated tests, and lists open items. It is the gate artifact reviewed before merging `feature/e8-creator-recruitment-growth` into `main`. E8 branches from `main` (which already contains E1 through E7), so this document covers only E8's own changes, including its small, additive touches to E3's `creator` entity/matching module, E6's `payments` module (one exported guard), and E7's `analytics` module (one exported method).

<p align="center"><strong>Table 1</strong></p>

<p align="center"><em>Stories in Scope for Epic E8</em></p>

<div align="center">

| Story | Priority | Persona | Status |
|---|---|---|---|
| US-23.1 Unclaimed Profile Created from Public Data | Must | Duda | Implemented, tested |
| US-23.2 Invitation and Claim Flow | Must | Duda | Implemented, tested |
| US-24.1 Link Social Accounts via Platform Authorization | Must | Duda | Implemented, tested |
| US-24.2 Compute and Maintain Audience Metrics | Must | Duda | Implemented, tested |
| US-24.3 Compute Authenticity Score | Must | Duda | Implemented, tested |
| US-24.4 Qualification Decision at the End of Onboarding | Must | Duda | Implemented, tested |
| US-25 Automatic Media Kit | Should | Duda | Implemented, tested |
| US-26 Visibility to Mid-Market Brands | Should | Duda | Implemented, tested (emergent from US-24.4 + E3's FR-25, no new mechanism of its own) |
| US-27 Creator-Set Rate Preferences | Could | Duda | Implemented, tested |

</div>

*Note.* Priority follows the MoSCoW scale defined in the product requirements document. US-23.1/US-23.2 and US-24.1 through US-24.4 are sub-stories of US-23 and US-24 respectively, each carrying its own FR and priority, the same resolution prior epics' stories documents already applied to their own sub-stories (e.g., E6's US-21a/US-21b). All six Must stories and both Should stories have a corresponding passing QA result; the one Could story (US-27) does as well, though its absence would not have blocked this gate on its own.

## 2. What Was Built

**Backend** (`backend/src/creator-network`): one new NestJS module, `creator-network`, alongside `auth`, `matching`, `brand-safety`, `content-workflow`, `payments`, `analytics`, `agency`, `audit`, and `jobs`. `creator-registration.service.ts`/`creator-registration.controller.ts` implement US-24.1's self-registration, email verification, and login (ADR-0050), reusing `AuthService`'s newly-exported `createUser`/`verifyEmailToken`/`authenticateCredentials` methods rather than duplicating password hashing, verification-token lifecycle, or credential checks. `unclaimed-profile.service.ts`/`ops-creator.controller.ts` implement US-23.1's ops-mediated unclaimed-profile creation (ADR-0054). `invitation.service.ts`/`creator-claim.controller.ts` implement US-23.2's invitation/claim/decline flow (ADR-0055), also calling into `AuthService.createUser` at claim-confirmation time rather than building a second credential path. `token-cipher.service.ts` implements ADR-0049's AES-256-GCM envelope encryption; `social-account.service.ts`/`social-account.controller.ts` implement US-24.1's OAuth linking using the stub-only `SocialAuthAdapter` (ADR-0051). `creator-metrics-pipeline.service.ts`/`compute-creator-metrics.processor.ts` implement US-24.2/US-24.3/US-24.4's metrics-computation-and-qualification pipeline, using the stub-only `CreatorAudienceInsightsAdapter` and `AuthenticityScoringAdapter` (ADR-0051, ADR-0052) and the qualification thresholds and pending-fallback mechanics of ADR-0053 (`creator-network.config.ts`). `onboarding.service.ts`/`onboarding.controller.ts` implement the status read and profile-correction step. `media-kit.service.ts`/`generate-media-kit.processor.ts`/`media-kit.controller.ts` implement US-25, calling `analytics`'s newly-exported `CreatorPerformanceService.getCreatorDeliveredPerformance` rather than re-deriving E7's own join logic (ADR-0057). `rate-preference.service.ts`/`rate-preference.controller.ts` implement US-27's bounded, current-value-only rate preferences (ADR-0058). `data-subject-request.service.ts` implements the ops-mediated LGPD rights queue that closes the gap the stories document's own open question 4 names (ADR-0056). `creator-network-scheduled-tasks.service.ts` implements all background jobs (`refresh-creator-audience-metrics`, `refresh-social-tokens`, `expire-unclaimed-profiles`, `expire-pending-invitations`, plus the two processors above). One migration (`1730000000000-CreatorNetworkSchema.ts`) adds the additive, nullable `creator` columns and creates the seven new tables, their constraints, and the `creator_public_import` immutability trigger.

The three changes to modules this epic does not own, exactly as the architecture document specified in advance: `payments.module.ts` additionally exports `OperatorAuthGuard` so `creator-network`'s ops endpoints can reuse it unchanged; `analytics.module.ts`/`creator-performance.service.ts` gain the one new exported `getCreatorDeliveredPerformance(creatorId)` method; and `backend/src/matching/creator-portal.controller.ts` has its pilot-only `login` handler, and the `JwtModule`/`ConfigModule` imports that existed only to support it, removed from `matching.module.ts` entirely. `creator-metrics.service.ts` (E3) gains one additive field, `authenticity_status`, on `GET /creators/:id/metrics`'s response, confirmed by reading the diff directly: `matching-config.ts`'s `authenticityFlag` threshold function, which implements ADR-0017's two-tier policy, is untouched by this epic's diff, so the new field is genuinely additive and does not alter that policy.

**Frontend** (`frontend/src/pages/creator-portal`): ten new pages implementing the full five-step onboarding flow plus registration, claim, social-account management, rate preferences, and the media kit (`register`, `verify-email`, `invitations/:token`, `onboarding/link-accounts`, `onboarding/review`, `onboarding/analyzing`, `onboarding/result`, `social-accounts`, `rate-preferences`, `media-kit`), and a rebuild of the existing `creator-access-page.tsx` from the old bare-`creator_id` stub form into a real email/password login form consistent with the backend's replacement of that same stub.

**QA, in one round covering all nine stories.** QA's own commit is unusual relative to every prior epic in this project in one specific respect, verified directly from the commit history: frontend-dev's commit added all ten new pages with zero accompanying spec files, and left the already-existing `creator-access-page.spec.tsx` absent for its rewritten form. QA's commit built the entire frontend test suite for this epic from scratch: ten new spec files, one per new page, all passing, plus the rewritten `creator-access-page.spec.tsx` for the real login form. QA additionally added `backend/src/auth/auth.service.spec.ts`, closing a coverage gap on `AuthService`'s three newly-exported methods that backend-dev's own commit had not covered directly. QA reported zero implementation bugs found across all nine stories. This review independently re-ran both test suites rather than taking QA's reported counts on faith: 468/468 backend tests passing (79 test files) and 181/181 frontend tests passing (42 test files), matching QA's reported figures exactly.

## 3. Compliance With ADRs and Architecture

**ADR-0049 (OAuth tokens envelope-encrypted, rotated by a proactive refresh job):** followed exactly, confirmed by reading `token-cipher.service.ts` and `creator-social-account.entity.ts` directly rather than the ADR's own narrative. `access_token_ciphertext`/`refresh_token_ciphertext` are AES-256-GCM ciphertext with a per-record nonce and `token_key_version`; no column on that entity is capable of holding a plaintext token. `refresh-social-tokens` (daily, 7-day lead time before a token's own expiry) is a real cron job, and its `revoked` branch sets `status = disconnected`/`disconnect_reason = revoked_by_platform` exactly as US-24.1 scenario 2 requires.

**ADR-0050 (creator identity reuses E1's auth pattern; real login replaces the E3 stub):** followed exactly. The former `POST /creator-portal/login { creator_id }` handler is fully gone, not merely unrouted: `creator-portal.controller.ts` no longer imports `JwtService` or has a `login` method, its own spec file was rewritten to drop all stub-login test cases, and `matching.module.ts` no longer imports `JwtModule`/`ConfigModule` at all. `creator-registration.service.ts` and `invitation.service.ts` both call `AuthService.createUser`/`verifyEmailToken`/`authenticateCredentials` directly; `AuthService.register`/`verifyEmail`/`login` (the brand-facing methods) are untouched by this epic's diff. `CreatorAuthGuard` and `JwtStrategy` both have a zero-line diff against `main`, confirming the claim that the replacement login requires no change to either.

**ADR-0051 (separate `SocialAuthAdapter` and `CreatorAudienceInsightsAdapter`, not an extension of E7's `SocialMetricsAdapter`):** followed exactly. `SocialMetricsAdapter` itself is untouched by this epic. Both new adapters are owned and consumed only within `creator-network`.

**ADR-0052 (authenticity scoring as its own adapter, extending ADR-0017's flag-only policy):** followed exactly. `authenticity_status` (`pending | scored | insufficient_data`) is a genuine, separate column from `authenticity_score`, and `CreatorMetricsPipelineService.evaluateQualification` never references authenticity in its qualification logic. The additive `authenticity_status` field added to E3's `GET /creators/:id/metrics` response does not touch `matching-config.ts`'s threshold function.

**ADR-0053 (qualification thresholds as a pilot default; pending fallback):** followed exactly. `QUALIFICATION_THRESHOLDS` (`minAudienceSize: 500`, `minEngagementRate: 1.0`) lives in `creator-network.config.ts`, mirroring `matching-config.ts`'s own precedent. The pending fallback sets `qualification_expected_ready_at = now() + 5 minutes` only on a transient adapter failure, never on a plain threshold miss, matching the ADR's explicit distinction.

**ADR-0054 (unclaimed-profile recruitment is ops-mediated; import snapshot structurally separate):** followed exactly. `POST /ops/creators/unclaimed` is gated by `OperatorAuthGuard`; `creator_public_import` has every field nullable except `source`, `imported_by_user_id`, and `imported_at`, and carries a database trigger that raises on any `UPDATE`. No automated discovery mechanism exists anywhere in the diff.

**ADR-0055 (claim/invitation lifecycle as its own token-based entity):** followed exactly, and independently re-verified against the migration's actual SQL rather than the architecture document's narrative alone. `creator_invitation.creator_id` is nullable with `ON DELETE SET NULL`, the one deliberate exception among this epic's seven new tables, all of which otherwise cascade. `InvitationService.declineInvitation` sets `status = declined` then deletes only the `creator` row, leaving the declined invitation row as the durable record. `CreatorNetworkScheduledTasksService.expireUnclaimedProfiles`, by contrast, explicitly deletes `creator_invitation` rows before deleting the creator row, a deliberate, different behavior from decline that the migration's FK policy alone would not produce. The code's explicit extra delete call is what makes the two paths' differing retention behavior actually correct, not an accident of the FK graph.

**ADR-0056 (LGPD ongoing rights via a minimal ops-mediated queue):** followed exactly. `creator_data_subject_request.due_at` is computed once at creation and never recalculated. No creator-facing endpoint to originate a request exists anywhere in the diff, matching the ADR's explicit scope limitation.

**ADR-0057 (media kit reuses E7's performance data via an exported service):** followed exactly. `GenerateMediaKitProcessor` calls `CreatorPerformanceService.getCreatorDeliveredPerformance(creatorId)`; `creator-network` contains no direct query against any E7-owned table.

**ADR-0058 (rate preference bounds and immutability):** followed exactly. `RatePreferenceService.setRate` rejects (422 `INVALID_RATE`) any value outside bounds before ever reaching the database, backed by the database's own check constraint. `creator_rate_preference` carries no history table of its own, relying entirely on E3's pre-existing payout-immutability trigger for the non-retroactivity guarantee, exactly as the ADR specifies; this epic's diff does not touch that trigger or `campaign_opportunity` at all.

**No deviation from any of the ten ADRs or the architecture document's data model was found.** Three items are recorded as disclosed, non-blocking observations rather than deviations:

1. The architecture document references an "E1/E3/E7 CI check" for RLS-table allow-listing that does not exist anywhere in this repository (no CI configuration at all). This is not a new gap E8 introduces; it is a pre-existing condition across the whole codebase that no prior epic's summary records as actually built either.
2. US-26 (Should priority) has no FR of its own traced to it in the PRD, a gap the stories document itself already flagged as open. This epic adds no new mechanism for US-26 beyond US-24.4's qualification gate and E3's existing matching, consistent with that framing; `recruitment_origin` is written once and read by no query anywhere in `matching` or `creator-network`.
3. Table 15's omission of NFR-26 and NFR-35 from E8's own NFR row is a PRD-level inconsistency, not an implementation gap, since both NFRs are applied anyway in the actual design.

## 4. Test Results

<p align="center"><strong>Table 2</strong></p>

<p align="center"><em>Automated Test Results by Package, Final State</em></p>

<div align="center">

| Package | Command | Result |
|---|---|---|
| Backend | `npx vitest run` (from `backend/`) | 79 test files, 468 tests, all passing |
| Frontend | `npx vitest run` (from `frontend/`) | 42 test files, 181 tests, all passing |
| Backend typecheck | `npx tsc --noEmit` (from `backend/`) | 4 errors, all pre-existing and unrelated, zero introduced by this epic |
| Frontend typecheck | `npx tsc --noEmit` (from `frontend/`) | 0 errors |

</div>

Backend coverage specific to this epic: fifteen new spec files under `backend/src/creator-network` (one per adapter, service, and processor, including `token-cipher.service.spec.ts` for ADR-0049's encryption round-trip and failure branches), plus the rewritten `creator-portal.controller.spec.ts`, plus QA's own addition of `auth.service.spec.ts`. Frontend coverage specific to this epic: ten new spec files, one per new creator-portal page, all authored by QA, plus the rewritten `creator-access-page.spec.tsx`.

## 5. Story Coverage

<p align="center"><strong>Table 3</strong></p>

<p align="center"><em>Story Coverage Against Automated Tests, Final State</em></p>

<div align="center">

| Story | Priority | Backend evidence | Frontend evidence | Final verdict |
|---|---|---|---|---|
| US-23.1 | Must | `unclaimed-profile.service.spec.ts` | n/a (ops-only endpoint) | Meets acceptance criteria |
| US-23.2 | Must | `invitation.service.spec.ts` | `claim-invitation-page.spec.tsx` | Meets acceptance criteria |
| US-24.1 | Must | `social-account.service.spec.ts`, `adapters/social-auth.adapter.spec.ts`, `token-cipher.service.spec.ts` | `onboarding-link-accounts-page.spec.tsx`, `social-accounts-page.spec.tsx` | Meets acceptance criteria |
| US-24.2 | Must | `creator-metrics-pipeline.service.spec.ts`, `adapters/creator-audience-insights.adapter.spec.ts`, `creator-network-scheduled-tasks.service.spec.ts` | `onboarding-analyzing-page.spec.tsx` | Meets acceptance criteria |
| US-24.3 | Must | `creator-metrics-pipeline.service.spec.ts`, `adapters/authenticity-scoring.adapter.spec.ts` | `onboarding-result-page.spec.tsx` | Meets acceptance criteria |
| US-24.4 | Must | `creator-metrics-pipeline.service.spec.ts`, `onboarding.service.spec.ts` | `onboarding-review-page.spec.tsx`, `onboarding-result-page.spec.tsx` | Meets acceptance criteria |
| US-25 | Should | `media-kit.service.spec.ts`, `generate-media-kit.processor.spec.ts` | `media-kit-page.spec.tsx` | Meets acceptance criteria |
| US-26 | Should | Covered indirectly by E3's pre-existing `real-matching-engine.adapter.spec.ts` (unchanged by this epic) | n/a (emergent, Section 3) | Meets acceptance criteria |
| US-27 | Could | `rate-preference.service.spec.ts` | `rate-preferences-page.spec.tsx` | Meets acceptance criteria |

</div>

All six Must-priority stories and both Should-priority stories in scope have corresponding passing test evidence at the backend layer, and at the frontend layer everywhere a frontend surface exists. The one Could-priority story (US-27) is also fully covered.

## 6. Deviations Summary

1. **Disclosed, confirmed accurate, non-blocking:** no CI configuration exists anywhere in this repository for the RLS-table check the architecture document references. Pre-existing, whole-project condition.
2. **Disclosed, confirmed accurate, non-blocking:** US-26 has no traced FR in the PRD; this epic adds no mechanism of its own beyond US-24.4 and E3's existing matching.
3. **Disclosed, confirmed accurate, non-blocking:** Table 15's omission of NFR-26/NFR-35 from E8's row is a PRD-level inconsistency; both are applied anyway.
4. **Process observation, not a code deviation:** frontend-dev's commit shipped ten new pages with zero accompanying test files, breaking this project's pattern from every prior epic. QA's subsequent commit closed this gap completely. No implementation bug resulted in this instance, but the pattern is worth flagging for the next epic's frontend-dev pass.
5. **No deviation found** between the implementation and any of the ten ADRs or the architecture document's data model, contracts, or state machines, beyond the three non-blocking documentation-level items above.

## 7. Open Items for the Next Epic

- Stand up the RLS/tenant-table CI check that the E1, E3, E7, and now E8 architecture documents all reference but which has never actually been built in this repository.
- Resolve, with product, whether US-26 should receive its own traced FR or remain permanently and explicitly emergent from FR-11/FR-25.
- Correct Table 15 of the PRD to include NFR-26 and NFR-35 against E8's row, or explicitly document why they were intentionally omitted.
- Resolve the stories document's own open question on identity ambiguity when two real people share a similar public presence, before recruitment volume scales past what one operator can manually cross-check.
- Decide whether `creator_data_subject_request` should grow a creator-facing intake endpoint rather than remain entirely ops-mediated.
- When a real `SocialAuthAdapter`/`CreatorAudienceInsightsAdapter`/`AuthenticityScoringAdapter` implementation is built for any platform, validate the qualification thresholds and the 5-minute pending-readiness figure against real nano-creator distributions.
- Carry forward the still-unresolved, whole-project items E6 and E7's own summaries already named: `TenantContextMiddleware` is still never registered in `app.module.ts`, and no real-Postgres integration-test harness exists.
- Require spec files to accompany new pages in the same commit for the next epic's frontend-dev pass, rather than relying on QA to build the entire suite retroactively.

## References

Aurora Project Team. (2026). *ADR-0013: creator entity scoped to E3's matching needs, explicitly extensible by a future recruitment epic*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0017: authenticity score flagged, never an automatic exclusion from matching*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0038: the aurora_operator principal and OperatorAuthGuard*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0044: performance metrics ingestion isolated behind a SocialMetricsAdapter, with only a stub implementation and a fixed 4-hour cadence in this pilot*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0049: OAuth tokens stored with application-level envelope encryption, rotated by a proactive refresh job*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0050: creator identity reuses E1's global user/auth pattern; real creator login replaces the E3 pilot stub*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0051: separate SocialAuthAdapter and CreatorAudienceInsightsAdapter, not an extension of E7's SocialMetricsAdapter*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0052: authenticity scoring as its own adapter, extending ADR-0017's flag-only policy to a real input*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0053: qualification thresholds set as a pilot default; decision evaluated synchronously with an explicit pending fallback*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0054: unclaimed-profile recruitment is ops-mediated; the public-data import snapshot is kept structurally separate from live creator fields*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0055: claim and invitation lifecycle modeled as its own token-based entity, decoupled from creator.status*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0056: ongoing LGPD data-subject rights for already-active creators, via a minimal ops-mediated request queue*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0057: media kit reuses E7's performance data via an exported service, never recomputing or duplicating it*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0058: rate preference validity bounds set as a pilot default; immutability relies entirely on E3's existing opportunity-snapshot trigger*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *E3, Creator matching and curation: Technical architecture*. Internal architecture specification, Aurora project.

Aurora Project Team. (2026). *E6, Payments and financial transparency: Summary*. Internal epic summary, Aurora project.

Aurora Project Team. (2026). *E7, Analytics and reporting: Summary*. Internal epic summary, Aurora project.

Aurora Project Team. (2026). *E7, Analytics and reporting: Technical architecture*. Internal architecture specification, Aurora project.

Aurora Project Team. (2026). *E8, Creator recruitment and growth: Stories*. Internal product requirements document, Aurora project.

Aurora Project Team. (2026). *E8, Creator recruitment and growth: Technical architecture*. Internal architecture specification, Aurora project.

Aurora Project Team. (2026). *Product requirements document*. Internal product requirements document, Aurora project.
