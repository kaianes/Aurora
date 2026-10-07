# Sprint 5 Delivery: Epic 2 and Epic 3

This document explains how Epic 2 (Campaign Planning and Pool Buying) and Epic 3 (Creator Matching and Curation) were produced and how to run and test them. It is meant as the entry point for grading Sprint 5: read this first, then follow the links to the deeper artifacts each stage produced. For the pipeline itself and how it produced Epic 1, see [docs/sprint-4-delivery.md](sprint-4-delivery.md) — the same five-stage pipeline (`product-analyst` → `architect` → `backend-dev`/`frontend-dev` → `qa` → `reviewer`) was used here, unchanged.

## 1. Branches and merge order

Both epics are still on feature branches, stacked on top of each other and not yet merged to `main`:

```
main
 └── feature/e2-campaign-planning-pool-buying   (E2; PR open: GitHub #1 / GitLab MR pending)
      └── feature/e3-creator-matching-curation  (E3; PR open: GitHub #2 / GitLab MR pending)
```

E3's `matching` module depends directly on E2's `campaign` module (it replaces E2's stub matching engine with a real one and writes into E2's `campaign_pool_member` table), so E3 was built on top of E2's branch rather than on `main`. **To see or run everything built so far, check out `feature/e3-creator-matching-curation`** — it contains E1 (already in `main`), E2, and E3.

## 2. What this pipeline produced

### Epic 2 — Campaign Planning and Pool Buying

- Stories: [docs/epics/e2-campaign-planning-pool-buying/stories.md](epics/e2-campaign-planning-pool-buying/stories.md)
- Architecture: [docs/architecture/e2-campaign-planning-pool-buying.md](architecture/e2-campaign-planning-pool-buying.md)
- ADRs: [0005-campaign-pool-allocation-model](adr/0005-campaign-pool-allocation-model.md), [0006-campaign-state-machine](adr/0006-campaign-state-machine.md), [0007-reallocation-bounds-defaults](adr/0007-reallocation-bounds-defaults.md), [0008-pool-shortfall-resolution-criteria](adr/0008-pool-shortfall-resolution-criteria.md), [0009-campaign-minimum-budget](adr/0009-campaign-minimum-budget.md), [0010-template-library-scope](adr/0010-template-library-scope.md)
- Implementation: `backend/src/campaign/` (new NestJS module: campaign CRUD, async quoting, confirm/pause/resume/cancel, shortfall resolution, budget reallocation, templates) and new frontend pages under `frontend/src/pages/app/` (`campaigns-page`, `campaign-form-page`, `campaign-detail-page`, `shortfall-page`, `templates-page`, `template-instantiate-page`)
- Epic summary (reviewer's output, the actual grading artifact): [docs/epics/e2-campaign-planning-pool-buying/summary.md](epics/e2-campaign-planning-pool-buying/summary.md)

### Epic 3 — Creator Matching and Curation

- Stories: [docs/epics/e3-creator-matching-curation/stories.md](epics/e3-creator-matching-curation/stories.md)
- Architecture: [docs/architecture/e3-creator-matching-curation.md](architecture/e3-creator-matching-curation.md)
- ADRs: [0011-real-matching-engine-scoring-model](adr/0011-real-matching-engine-scoring-model.md) through [0018-additional-candidates-as-top-up](adr/0018-additional-candidates-as-top-up.md)
- Implementation: `backend/src/matching/` (new NestJS module: real matching engine replacing E2's stub, shortlist generation/approval, creator exclusions, agency override, creator-portal opportunities) and new frontend pages (`shortlist-page`, `creator-metrics-page`, `exclusions-page`, `shortlist-override-page`, plus a separate `creator-portal/` route tree for the creator-facing opportunity flow)
- Epic summary (reviewer's output, the actual grading artifact): [docs/epics/e3-creator-matching-curation/summary.md](epics/e3-creator-matching-curation/summary.md)

Both summaries flag the same carried-over gap first raised in E1's review: `TenantContextMiddleware` is still not registered in `AppModule`, so row-level security is defined in the database but not enforced at runtime; isolation currently relies on explicit `accountId`/`creatorId` filtering in application code, checked in every new service. This remains open for a future sprint.

## 3. How to run it

```bash
# 0. Check out the branch that has both epics
git checkout feature/e3-creator-matching-curation

# 1. Start Postgres and Redis
docker compose up -d

# 2. Backend
cd backend
cp .env.example .env
npm install
npx tsx src/database/run-migrations.ts
npm run start:dev        # http://localhost:3001/v1

# 3. Frontend (separate terminal)
cd frontend
npm install
npm run dev               # http://localhost:5173
```

Live, interactive API documentation (Swagger/OpenAPI) is available once the backend is running, at `http://localhost:3001/api/docs`, now also listing the `campaign` and `matching` modules alongside E1's.

As in E1, the email provider is a console-log stub (`EMAIL_PROVIDER=console`): verification and invitation links print to the backend terminal instead of arriving in an inbox.

## 4. How to test it

**Automated tests**, run from each project's own directory:

```bash
cd backend && npx vitest run
cd frontend && npx vitest run
```

As of the last pipeline run: **backend 107/107 passing**, **frontend 31/31 passing** (both suites include E1, E2, and E3 together, since all three live on the same branch). Build and lint are clean on both packages. Exact per-story pass/fail counts are reported in each epic's [E2](epics/e2-campaign-planning-pool-buying/summary.md) and [E3](epics/e3-creator-matching-curation/summary.md) summary, since those are qa's and the reviewer's verified output rather than a claim made ahead of time.

**Manual walkthrough**, once both servers are running and you have a brand account from the E1 flow (see [sprint-4-delivery.md](sprint-4-delivery.md#5-how-to-test-it)):

1. At `/app/campaigns`, create a campaign: set a budget (minimum R$ 2,000, per ADR-0009), audience targeting, message, and deliverable formats.
2. Request a quote; the page polls until the async job resolves to a locked price and guaranteed minimum pool size.
3. Confirm the campaign, then open its shortlist (`/app/campaigns/:id/shortlist`) to see creators ranked by fit, with audience/authenticity/engagement metrics, and approve or reject individual creators.
4. At `/app/exclusions`, add a creator or competitor-brand exclusion and confirm it only affects future shortlist generations, not the current one.
5. As an agency role, try the shortlist override screen to remove/add creators against the agency's own network.
6. Visit `/creator-portal` with a seeded creator ID (the pilot login stub, ADR-0013) to accept or decline an opportunity as Duda would.
7. Pause, resume, or cancel the campaign from the detail page and confirm the state transitions match the rules in [ADR-0006](adr/0006-campaign-state-machine.md).

The full API contracts for both epics are in their architecture documents linked in section 2 above.

## 5. Known limitations carried into Sprint 6

- No `CONFIRMED → ACTIVE` campaign-state transition exists yet, so the shortlist lock-on-activation path is only exercisable today through the agency-override trigger. Flagged in both E2's and E3's summaries, not a defect in either epic individually.
- Automatic budget reallocation (E2, US-10) is fully implemented and tested but inert in this build, since it depends on a social-platform metrics feed (FR-52) that is out of scope until a later epic.
- Commission rate (15%) and opportunity expiry window (72h) in E3 are explicit placeholders pending Epic 6 (Payments and Financial Transparency).
- The creator-portal login (`POST /creator-portal/login`) is a passwordless pilot stub pending Epic 8 (Creator Recruitment and Growth)'s real creator authentication.
- Tenant-context middleware (RLS enforcement) remains unregistered, carried over from E1 — see Section 2 above.

## 6. Reading order for grading

1. This document, for the process and how to run both epics.
2. [docs/epics/e2-campaign-planning-pool-buying/summary.md](epics/e2-campaign-planning-pool-buying/summary.md) and [docs/epics/e3-creator-matching-curation/summary.md](epics/e3-creator-matching-curation/summary.md), for what was actually built and verified, and any deviations from the design.
3. The architecture documents and ADRs linked in section 2, for the design rationale.
4. The running application, using the steps in sections 3 and 4 above.
