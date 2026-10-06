# Epic E3, Creator Matching and Curation: Summary

**Author:** Kaiane Cordeiro. Aurora Project, Sprint 5. **Date:** October 5, 2026.

## 1. Purpose

This document summarizes what was built for Epic E3 (Creator Matching and Curation), checks it against the ADRs and architecture specification, reports the actual state of automated tests, and lists open items. It is the gate artifact reviewed before merging `feature/e3-creator-matching-curation` into `main`. E3 was built on top of `feature/e2-campaign-planning-pool-buying`, which has not yet been merged to `main`; this review covers only the diff introduced by E3, not E2's own changes, which are covered in `docs/epics/e2-campaign-planning-pool-buying/summary.md`.

<p align="center"><strong>Table 1</strong></p>

<p align="center"><em>Stories in Scope for Epic E3</em></p>

<div align="center">

| Story | Priority | Persona | Status |
|---|---|---|---|
| US-11 Automatic Shortlist Ranked by Fit | Must | Marina | Implemented, tested |
| US-12 Inspect Audience and Authenticity Metrics | Must | Marina | Implemented, tested |
| US-13 Approve or Reject Individual Creators on a Shortlist | Must | Marina | Implemented, tested |
| US-14 Exclusion List for Creators and Competitor Associations | Should | Marina | Implemented, tested (competitor-brand check is an intentional no-op per architecture) |
| US-28 Creator Reviews and Accepts/Declines an Opportunity | Must | Duda | Implemented, tested; pool-propagation gap found and fixed post-review (see Section 3) |
| US-40 Agency Overrides the Shortlist with Its Own Network | Must | Renata | Implemented, tested |

</div>

*Note.* Priority follows the MoSCoW scale defined in the product requirements document.

## 2. What Was Built

**Backend** (`backend/src/matching`): one new NestJS module, `matching`, covering all six stories. `shortlist.service.ts`/`shortlist.controller.ts` implement shortlist request/poll (US-11), approve/reject and bulk decisions (US-13), the additional-candidates top-up (ADR-0018), and the agency override (US-40). `generate-shortlist.processor.ts` runs asynchronous shortlist generation against `real-matching-engine.adapter.ts`, which replaces E2's `StubMatchingEngineAdapter` behind the same `MATCHING_ENGINE_ADAPTER` token (ADR-0011). `exclusion.service.ts`/`exclusion.controller.ts` implement US-14. `creator-metrics.service.ts`/`creator.controller.ts` implement US-12. `opportunity.service.ts`/`creator-portal.controller.ts` implement US-28, guarded by `creator-auth.guard.ts` and a `creator_id`-carrying JWT branch added to `jwt.strategy.ts`. `matching-scheduled-tasks.service.ts` runs the opportunity-expiry and metrics-staleness crons. One migration (`1705000000000-MatchingSchema.ts`) creates the six new tables, RLS policies, and the locked-shortlist/payout-immutability triggers.

**Frontend** (`frontend/src`): implements the route map from architecture section 5 (`/app/campaigns/:id/shortlist`, creator metrics detail, `/app/exclusions`, `/app/campaigns/:id/exclusions`, the agency override screen, `/creator-portal/opportunities`), plus a dedicated creator-portal layout and login screen.

**Cross-track gap found and resolved before QA.** Backend-dev and frontend-dev worked in parallel without coordinating on the creator-portal auth boundary. The backend shipped `POST /creator-portal/login` as a pilot stub per ADR-0013. The frontend's first pass accepted a manually pasted token instead of calling it. This was found and corrected before QA ran: `creator-access-page.tsx` now calls `creatorPortalApi.login`, which posts to the real endpoint.

**QA round.** QA found zero implementation bugs and closed test-coverage gaps the dev pass had left open, adding `creator-metrics.service.spec.ts` and `creator-portal.controller.spec.ts` (previously untested) plus five frontend spec files (previously zero E3 frontend coverage). Total after QA: 34 backend + 31 frontend tests, 65 in total.

**Reviewer round finding and resolution.** The final review independently re-read the implementation against the ADRs (not just QA's report) and found a real, previously unflagged gap: ADR-0012 states that when an opportunity is declined or expires, "the actual removal-from-pool effect happens through an emitted domain event... that `campaign`'s existing `pool-fill-check` job already consumes." No such propagation existed — `decline` and the expiry cron only flipped the shortlist entry's `included` flag and wrote an audit log; `campaign_pool_member` was never touched, so a late decline or expiry after an agency-override lock would never register as a shortfall. This has been fixed: `OpportunityService.decline` and `MatchingScheduledTasksService.expireOpportunities` now mark the corresponding `campaign_pool_member` row `EXCLUDED`, and `PoolFillCheckProcessor`'s count now excludes `EXCLUDED` members, so the existing shortfall-detection path (unchanged otherwise) correctly reflects a post-lock removal. Two new/updated tests were added (`opportunity.service.spec.ts`, a new `matching-scheduled-tasks.service.spec.ts`, and an assertion added to `pool-fill-check.processor.spec.ts`); the full suite was re-run and passes (107 backend tests, up from 98, 31 frontend tests unaffected).

## 3. Compliance With ADRs and Architecture

**ADR-0011 (Real Matching Engine as a Weighted, Multi-Signal Scoring Model):** followed. `RealMatchingEngineAdapter.generateShortlist` gates on eligibility (status, onboarding, exclusions, non-zero audience overlap) before scoring, then weights audience-attribute match, authenticity, engagement percentile, and historical reliability, defaulting absent signals to a neutral `0.5`, exactly as specified. **Minor, disclosed gap:** the `geography` dimension of `audienceAttributeMatch` always reports a match, because the minimal `creator` entity (ADR-0013) has no geography field yet. The code comments this honestly; it was not previously surfaced in the architecture's open-questions table, so it is flagged here as a known limitation rather than a defect to fix in this epic — E8's creator profile work is the natural place to add real geography data.

**ADR-0012 (Shortlist Locking and Indirection via `campaign_pool_member`):** followed, after the fix described in Section 2. `lockAndHandoff` writes one `campaign_pool_member` row per included entry and creates opportunities, exercised today through the agency-override trigger (the only lock path that exists; see the campaign-activation gap below). The decline/expiry-to-pool-member propagation this ADR requires is now implemented and tested.

**ADR-0013 (Minimal Creator Entity in E3):** followed. The `creator` table matches the architecture's field list; the pilot creator-portal login is scoped exactly as the ADR describes (no password, JWT from a seeded `creator_id`), and the frontend now correctly calls it.

**ADR-0014 (Exclusion Precedence Over Agency Network):** followed. `overrideShortlist` checks every `add_creators` entry against the account's exclusion list and rejects with a distinct `CREATOR_EXCLUDED` code before any eligibility check runs.

**ADR-0015 (Override Sequencing and Opportunity Honoring):** followed. Removing an entry during override only sets `included = false`; an already-sent, already-accepted opportunity is never retroactively revoked. `OpportunityService.accept` detects the stale-entry case and returns a `note` telling the creator the pool has changed.

**ADR-0016 (Guaranteed Minimum Advisory on Override):** followed. The override endpoint never blocks on a resulting shortfall; it recomputes and persists the below-minimum flag as an advisory only.

**ADR-0017 (Authenticity Score Flag-Only Policy):** followed. The matching engine's eligibility gate never reads `authenticityScore`; the two-tier flag (`<50`/`50-69`) is always present in the metrics response, never hidden for a low score.

**ADR-0018 (Additional Candidates as Top-Up):** followed. The top-up request computes only the remaining shortfall, not the full minimum, and never touches `campaign_quote` or the locked price.

**Known, disclosed gaps, confirmed accurate, not fixed in this epic:**
1. No `CONFIRMED → ACTIVE` campaign-state transition exists yet, so the "lock on activation" path (architecture section 2.6, US-13 scenario 3) has no code trigger; the lock mechanism is exercised in this epic only through the agency-override path. Implementing that transition is cross-epic work, correctly deferred.
2. The 15% commission rate and 72-hour opportunity expiry are explicit placeholders pending E6's real values.
3. `POST /creator-portal/login` is a passwordless pilot stub pending E8's real creator authentication.
4. `TenantContextMiddleware` remains unregistered in `AppModule`, carried over from E1/E2. Application code continues to filter explicitly by `accountId`/`creatorId`, checked and found consistent in this module.

## 4. Test Results

<p align="center"><strong>Table 2</strong></p>

<p align="center"><em>Automated Test Results by Package</em></p>

<div align="center">

| Package | Command | Result |
|---|---|---|
| Backend | `npx vitest run` (from `backend/`) | 20 test files, 107 tests, all passing |
| Frontend | `npx vitest run` (from `frontend/`) | 8 test files, 31 tests, all passing |

</div>

Backend coverage includes `exclusion.service.spec.ts`, `generate-shortlist.processor.spec.ts`, `opportunity.service.spec.ts`, `real-matching-engine.adapter.spec.ts`, `shortlist.service.spec.ts`, `creator-metrics.service.spec.ts`, `creator-portal.controller.spec.ts`, and the new `matching-scheduled-tasks.service.spec.ts`, plus the updated assertion in `pool-fill-check.processor.spec.ts` covering the ADR-0012 fix. Frontend coverage includes `creator-metrics-page.spec.tsx`, `exclusions-page.spec.tsx`, `shortlist-override-page.spec.tsx`, `shortlist-page.spec.tsx`, and `opportunities-page.spec.tsx`, plus carried-over E1/E2 specs.

## 5. Story Coverage

<p align="center"><strong>Table 3</strong></p>

<p align="center"><em>Story Coverage Against Automated Tests and QA Results</em></p>

<div align="center">

| Story | Priority | Backend evidence | Frontend evidence | Final verdict |
|---|---|---|---|---|
| US-11 | Must | Ready, no-viable-pool, failed/timeout paths, below-minimum flag | `shortlist-page.spec.tsx` | Meets acceptance criteria |
| US-12 | Must | Metrics with matched attributes, low-score flag, stale metrics | `creator-metrics-page.spec.tsx` | Meets acceptance criteria |
| US-13 | Must | Single/bulk decision, below-minimum warning, locked rejection | `shortlist-page.spec.tsx` | Meets acceptance criteria; scenario 3 only reachable via override lock today, by design |
| US-14 | Should | Brand/campaign exclusion creation, union resolution, non-retroactive | `exclusions-page.spec.tsx` | Meets acceptance criteria |
| US-28 | Must | Accept, decline, expiry, race-condition guard, pool propagation (fixed) | `opportunities-page.spec.tsx` | Meets acceptance criteria after ADR-0012 fix |
| US-40 | Must | Override remove/add, exclusion/eligibility/tenant checks, audit snapshot | `shortlist-override-page.spec.tsx` | Meets acceptance criteria |

</div>

## 6. Deviations Summary

1. **Resolved before merge:** `opportunity.declined`/`opportunity.expired` did not propagate to `campaign_pool_member`, contrary to ADR-0012. Found in final review, fixed, and re-verified with new tests.
2. **Resolved before QA, cross-track coordination gap:** the frontend's creator-portal login initially bypassed the real login endpoint. Fixed and independently re-confirmed.
3. **Disclosed and unresolved, by design:** no `CONFIRMED → ACTIVE` campaign transition exists yet; the shortlist lock-on-activation path is only exercised via agency override in this epic.
4. **Disclosed and unresolved, by design:** 15% commission and 72-hour expiry are placeholders pending E6.
5. **Disclosed and unresolved, by design:** `POST /creator-portal/login` is a passwordless pilot stub pending E8.
6. **Minor, disclosed:** the matching engine's geography dimension always reports a match, since the minimal creator entity has no geography field yet.
7. **Carried over from E1/E2, not fixed here:** `TenantContextMiddleware` remains unregistered; isolation relies on explicit filtering in application code, checked and found consistent in this module.

## 7. Open Items for the Next Epic

- Implement the `CONFIRMED → ACTIVE` campaign transition and re-verify the shortlist lock-on-activation path through that trigger, not just agency override.
- When E8 ships real creator geography data, make `audienceAttributeMatch` actually check it instead of assuming a match.
- Register the tenant-context middleware correctly and add an RLS-coverage test — unresolved across three epics now.
- Replace the pilot creator-portal login with E8's real creator authentication flow.
- Replace the 15% commission and 72-hour expiry placeholders with E6's real values.

## References

Aurora Project Team. (2026). *ADR-0011: Real matching engine as a weighted, multi-signal scoring model behind the existing adapter interface*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0012: Shortlist locking and indirection via campaign_pool_member*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0013: Minimal creator entity in E3*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0014: Exclusion precedence over agency network additions*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0015: Override sequencing and opportunity honoring*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0016: Guaranteed minimum advisory on override*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0017: Authenticity score flag-only policy*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0018: Additional candidates as a top-up, not a requote*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *E2, Campaign planning and pool buying: Summary*. Internal epic summary, Aurora project.

Aurora Project Team. (2026). *E3, Creator matching and curation: Stories*. Internal product requirements document, Aurora project.

Aurora Project Team. (2026). *E3, Creator matching and curation: Technical architecture*. Internal architecture specification, Aurora project.
