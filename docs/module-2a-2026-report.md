# Aurora — Module 2A2026 Project Report

**Author:** Kaiane Souza Cordeiro
**Institution:** Inteli
**Period covered:** Sprints 1 through 7 (business analysis, product requirements, implementation of Epics 1 through 10, advisor remediation, and production verification)
**Date:** November 23, 2026
**Repository tag at time of writing:** `sprint-7`

## 1. Executive Summary

Aurora is a creator-media infrastructure platform for the mid-market: it lets a brand treat a curated pool of nano and micro creators as a single media unit that can be planned, bought, and reported on like paid media, while treating creators themselves as customers rather than anonymous supply. The project moved from pure market research (Sprint 1) through business analysis and a full product requirements specification (Sprints 2–3) into a ten-epic implementation (Sprints 4–7), built end to end with a NestJS/PostgreSQL backend and a React/Vite frontend, using a repeatable agent pipeline (product-analyst → architect → backend-dev/frontend-dev → QA → reviewer) for every epic.

By the `sprint-7` tag, all ten epics are merged to `main`: Access and Onboarding, Campaign Planning and Pool Buying, Creator Matching and Curation, Brand Safety, Briefing and Content Workflow, Payments and Financial Transparency, Analytics and Reporting, Creator Recruitment and Growth, Agency Multi-Client Operations, and AI Creator Demo (live Claude API integration). The cumulative automated suite stands at 523 backend tests (87 test files) and 218 frontend tests (49 test files), all passing, independently re-verified rather than taken on faith from any single commit message.

This report is written in the same spirit the project's own epic summaries use: it states what was built, cites the evidence, and names what is still broken or unverified as plainly as what works. Sprint 6's remediation pass closed the single most-repeated critical finding across every one of the first nine epic reviews (row-level security never actually engaged at runtime) and a related authorization bypass; Sprint 7 proved tenant isolation in production (the BYPASSRLS hypothesis was confirmed and resolved by switching the Railway connection to a non-superuser `aurora_app` role, then verified live with real cross-tenant 404 responses), completed advisor Tier 1–3 feedback items, added a real-Postgres integration harness to both CI pipelines, and delivered Epic 10 — described in Section 8 of this report.

## 2. Problem and Market Context

Aurora's business analysis (`docs/business-analysis.md`) grounds the product in three findings. First, the creator economy is large and still growing (estimates range from roughly $205B to $323B in 2025–2026, with most projections pointing toward $1T+ by the early 2030s), but adoption among Brazilian advertisers is shallow: only about 2% of Brazil's roughly R$80B media budget currently goes to creator partnerships. Second, every one of Aurora's four original differentiation pillars — programmatic pool buying, real-time budget optimization, message-level brand safety, and a curated nano/micro network — turned out to already be occupied by an established competitor (Creator Ads, Squid, CreatorIQ, Sandwiche, or BR Media Group) once checked directly against competitor behavior rather than marketing claims. Third, two gaps remain genuinely open: the mid-market (brands too small for enterprise platforms like CreatorIQ, which starts above $35k/year, but too complex to run on spreadsheets) and treating creators as a retained customer base rather than disposable supply.

Three personas anchor the product: **Marina**, a brand media manager blocked by entry cost (enterprise pricing, heavy onboarding) and coordination cost (effort scales with every creator added); **Duda**, a nano creator whose journey is flat and low across nearly every phase — payment is slow and opaque, briefs are vague, and fewer than one in five creators like her have ever been paid at all; and **Renata**, an agency partner whose curation work is her one high point and does not scale, and whose margin is eaten by per-client operational rebuilding. Three field interviews (with practitioners at Creator Ads and PlayNest, conducted and analyzed personally rather than through desk research alone) cross-checked these hypotheses against people actually operating in this market; a PlayNest insight about brands wanting to buy creator access as a budget pool rather than negotiate per creator directly validated Epic 2's pricing model.

## 3. Product Scope

The product requirements document (`docs/product-requirements.md`) traces 47 user stories and 60 functional requirements back to nine epics, each one justified by a specific journey friction point rather than chosen as a convenient module boundary:

| Epic | Name | Friction It Removes |
|---|---|---|
| E1 | Access and Onboarding | Entry blocked by enterprise pricing and heavy onboarding |
| E2 | Campaign Planning and Pool Buying | Creator cost cannot be predicted or budgeted like media |
| E3 | Creator Matching and Curation | Matching is slow, manual, and hard to judge |
| E4 | Brand Safety | Off-message content discovered only after publication |
| E5 | Briefing and Content Workflow | Briefings are vague and review cycles are silent |
| E6 | Payments and Financial Transparency | Payment is slow, opaque, and non-negotiable |
| E7 | Analytics and Reporting | Results are scattered and ROI is unprovable |
| E8 | Creator Recruitment and Growth | Good creators are invisible unless they self-register |
| E9 | Agency Multi-Client Operations | Running several clients means rebuilding everything per client |

Acceptance criteria throughout follow Given/When/Then, and every story carries a MoSCoW priority. Creator-side requirements (payment speed, briefing clarity, active recruitment) are deliberately prioritized as highly as brand-facing features, on the explicit reasoning that Aurora wins brands by first winning creators — a loyal, well-treated creator base is what makes predictable campaign quality possible, and active recruitment outside open self-registration is argued to be the product's only durable competitive advantage.

## 4. Architecture and Technical Approach

Aurora is a modular monolith: a single NestJS backend with one module per epic (`auth`, `campaign`, `matching`, `brand-safety`, `content-workflow`, `payments`, `analytics`, `creator-network`, `agency`), a PostgreSQL 16 database with one migration per epic, Redis-backed Bull queues for asynchronous jobs, and a React/Vite frontend with route-based pages per epic. Multi-tenancy is designed around PostgreSQL row-level security: every tenant-scoped table carries `ENABLE ROW LEVEL SECURITY`, `FORCE ROW LEVEL SECURITY`, and a policy keyed on a session variable, `app.current_account_id`, intended to be set at connection checkout so that, per the architecture document's own framing, "a handle without one cannot be obtained." Section 7 below documents in detail why this design was correctly specified in every migration since Epic 1 but never actually engaged at runtime until a same-day fix late in this reporting period — and a further, unconfirmed concern about whether it is engaged even now.

Authorization is layered: `JwtAuthGuard` authenticates, `RolesGuard` resolves an account relationship and checks role membership, and route-level decorators (`@Public()`, and as of this period's remediation, `@CreatorPortalRoute()`) declare exemptions explicitly rather than inferring them from request shape. Sixty-four architecture decision records (ADRs) document the reasoning behind these and every other significant technical choice, each with context, a decision, and consequences, including rejected alternatives and their rationale — a level of explicit trade-off documentation the project maintained across all nine epics and the remediation pass.

Every epic was built by the same fixed pipeline of specialized agents rather than one agent doing everything end to end: a product-analyst turns an approved epic into Given/When/Then stories; an architect defines the data model, API contracts, and ADRs; backend-dev and frontend-dev implement against that specification; QA writes and runs the automated suite and reports failures back; and a reviewer independently re-verifies the diff against the ADRs before the epic is considered mergeable, writing a signed review summary in APA-referenced English prose. This pipeline is itself documented transparently in the repository (`.claude/agents/`), consistent with the project's position that AI-assisted development is legitimate as long as it is disclosed and the author can defend the resulting code.

## 5. Delivery Timeline

| Sprint | Focus | Outcome |
|---|---|---|
| 1 | Market research, competitive landscape, initial pivot to mid-market/fair-payment thesis | Qualitative feedback only; no numeric grade |
| 2 | Business frameworks (Porter, SWOT, gap analysis, personas, value proposition canvas) | Qualitative feedback only; strategic pivot specifically praised |
| 3 | User journeys, 47 user stories, 60 functional and 36 non-functional requirements, architecture | Qualitative feedback only; documentation praised as robust |
| 4 | Agent pipeline defined; Epic 1 built end to end | 9.0/10, conditioned on demonstrated understanding of agent-generated code |
| 5 | Epics 2 and 3 built; public GitLab mirror published | 9.0/10 (official); a separate hands-on API test independently revised its own working score from 7.7 to 7.1 after finding real defects |
| 6 (this report) | Epics 4 through 9 built; tenant-isolation remediation; repository hygiene pass | Not yet formally graded |

Every formal sprint evaluation from Sprint 4 onward named the same handful of technical gaps — `TenantContextMiddleware` never registered, no CI pipeline, a frontend test alias hardcoded to the author's own machine path, and two invalid `tsconfig.json` options breaking lint — and every one of those gaps, except the first (closed in this reporting period's remediation, Section 7), remained open across every epic from the sprint that first named it through at least Epic 9's own review. This recurrence pattern is itself a notable finding of this report, not only the individual bugs: documentation of a defect, however honest and immediate, was not sufficient on its own to get it fixed across five sprints of reviews that kept naming it.

## 6. What Was Built, Epic by Epic

**Epic 1 — Access and Onboarding.** Self-service registration and email verification, workspace configuration, team invitations with role-based access control, agency client-account management, and MFA (TOTP) support, with its activation API complete but no frontend enrollment screen built until a later gap-closing pass added the login-time challenge UI only. 17 backend tests at merge.

**Epic 2 — Campaign Planning and Pool Buying.** A brand defines budget, audience, and message once; sees an estimated pool size, reach, and price before committing; buys the pool at one locked price via an async quoting flow; and can save a campaign as a reusable template. Introduced the `CampaignStateMachine` (draft → quoted → confirmed → active → paused/cancelled/completed) that later epics' known gaps trace back to. 54 backend / 13 frontend tests at merge.

**Epic 3 — Creator Matching and Curation.** Replaced Epic 2's placeholder matching engine with a real one scoring audience fit, authenticity, engagement, and reliability; added creator approve/reject, exclusion lists, agency shortlist override, and a minimal creator-portal opportunity accept/decline flow. 107 backend / 31 frontend tests at merge.

**Epic 4 — Brand Safety.** Brand-defined safety rulesets and prohibited topics, message-level AI-assisted content checking before publication, a human review queue for flagged content, and post-publication monitoring. 185 backend / 48 frontend tests at merge.

**Epic 5 — Briefing and Content Workflow.** Structured briefing composition and pool-wide distribution, draft submission with versioning, and an approve/reject cycle with a stated reason, closing the "unpaid rework" friction named in the creator journey. 247 backend / 75 frontend tests at merge.

**Epic 6 — Payments and Financial Transparency.** Consolidated pool invoicing for brands, payout obligation tracking and execution scaffolding, and a visible payment/commission breakdown for creators, with the real Brazilian PSP/Pix integration explicitly deferred as a pilot-stage placeholder. 323 backend / 92 frontend tests at merge.

**Epic 7 — Analytics and Reporting.** A consolidated dashboard by creator and by pool, exportable ROI reports, and agency-facing branding on client reports. 389 backend / 127 frontend tests at merge.

**Epic 8 — Creator Recruitment and Growth.** Full creator self-registration and email verification, social-account linking and onboarding, a media kit, rate preferences, and the creator portal's real authentication (replacing Epic 3's pilot creator-ID-only stub). 468 backend / 181 frontend tests at merge.

**Epic 9 — Agency Multi-Client Operations.** Client-context switching, template copying across clients, a white-label branding profile, an audit-log viewer, and a token-gated public share link for client reports. Its own review found and fixed a cross-tenant IDOR in that share-link mechanism and a React Query cache-key staleness bug before merge. 508 backend / 208 frontend tests at merge.

**Epic 10 — AI Creator Demo (Sprint 7).** Live Claude API integration across three touch points: (1) a fit-reason explanation generated per shortlisted creator at shortlist-time, stored in the `fit_reason` column and surfaced in the shortlist UI; (2) a semantic brand-safety tier-2 check using Claude as a second gate after deterministic rule matching; (3) a streaming briefing Q&A assistant for creators, delivered via Server-Sent Events from a single POST endpoint. A fourth stub — an animated onboarding screen for creators — required only frontend animation, not a new API call. Architecture decisions: an `@Global()` `InferenceModule` wraps the Anthropic SDK (ADR-0065); default model `claude-sonnet-4-5` with per-use-case token budgets (ADR-0066); POST+SSE pattern without NestJS's `@Sse()` decorator (ADR-0067); fit reason generated inside the matching engine adapter at shortlist time rather than on-demand (ADR-0068). 523 backend / 218 frontend tests at merge — the project's cumulative automated total at final delivery.

## 7. Known Issues and Technical Debt

This section exists because the project's own reviewing convention treats an undisclosed defect as worse than a disclosed one. Every item below was independently verified against the current codebase, not copied from a prior summary without re-checking.

**Resolved in this reporting period's remediation pass.** `TenantContextMiddleware`, the component meant to set `app.current_account_id` for every RLS policy to key on, was never registered in `AppModule` and — a deeper problem this period's own architectural review surfaced — could never have worked as middleware at all, since NestJS runs middleware before guards, and the account id was only resolved inside a guard. The fix (ADR-0063) replaces it with a `NestInterceptor`, registered via `APP_INTERCEPTOR`, that pins each request's downstream database calls to one `AsyncLocalStorage`-scoped transaction using the `typeorm-transactional` library, requiring no change to any of the 70 files using the standard repository-injection pattern. A related bug (ADR-0064): `RolesGuard` returned `true` whenever it could not resolve an account id, which let a creator-portal JWT reach any brand- or agency-scoped route with no role check and no audit trail; the fix adds an explicit `@CreatorPortalRoute()` decorator at all 13 legitimate call sites and fails closed everywhere else. Both fixes were independently re-verified clause by clause against their governing ADRs, with 518/518 backend tests passing and a clean build.

**Resolved in Sprint 7: BYPASSRLS confirmed and fixed in production.** The hypothesis from Sprint 6's remediation — that Aurora had always connected as a PostgreSQL superuser with `BYPASSRLS`, making every RLS policy structurally inert — was confirmed correct. The fix: the Railway connection was switched from the bootstrap superuser `aurora` to a new, non-superuser role `aurora_app` (created by a migration, with `NOBYPASSRLS`), and a separate `aurora_migration` role with elevated privileges used only by CI and seed scripts. Cross-tenant isolation was then verified directly against the live production deployment: `PATCH`ing Tenant B's `brand_profile` UUID with Tenant A's token returned `404 PROFILE_NOT_FOUND` in both directions. This is proven, not just unit-tested.

**Resolved in Sprint 7: CI pipeline, real-Postgres integration, and creator seed.** GitHub Actions (`/.github/workflows/ci.yml`) and GitLab CI (`.gitlab-ci.yml`) both now run lint, unit tests, real-Postgres integration tests (connecting to `postgres:16-alpine` as the migration superuser, creating `aurora_test`, running migrations, provisioning `aurora_app`), and build on every push to `main`. The real-Postgres harness (`backend/test/e2e/global-setup.ts`) is what confirmed the BYPASSRLS root cause. A creator seed script (`npm run seed:creators`) populates 30 qualified creators; `npm run seed:demo` seeds the full demo scenario used in the presentation.

**Defects still open at final delivery.** A creator cannot decline a campaign opportunity: `OpportunityService.decline` updates a `campaign_shortlist_entry` row that, by the time any opportunity exists, is always locked, and a database trigger rejects that exact update. No campaign can reach its first `ACTIVE` state: only the `resume()` method (from `PAUSED`) ever sets that state, and no `CONFIRMED → ACTIVE` transition exists anywhere in the codebase, which also makes `pause()` unreachable through the normal lifecycle. Three of the matching engine's four audience-targeting dimensions (geography, age range, gender) unconditionally report a match regardless of the creator's actual data. The backend's `tsconfig.json` carries two TypeScript options removed by the current compiler version (`noImplicitAny` and `strictPropertyInitialization` as top-level keys that the installed compiler ignores), producing pre-existing lint warnings that do not affect the build. The Epic 10 SSE endpoint is missing the `X-Accel-Buffering: no` header recommended for nginx reverse proxies (non-blocking for Railway's direct deployment).

**Repository hygiene.** Interview-analysis PDFs remain in the internal GitLab repository only (not in the public GitHub mirror), as the interviewees did not authorize public disclosure. The `README.md` was updated to cover all 10 epics with accurate test counts and live deployment links.

## 8. Deployment

A live demo runs on Railway (backend, Postgres, Redis) and Vercel (frontend static site), both deploying from `main` on the public GitHub mirror. Frontend: `https://aurora-kaiane.vercel.app`. Backend API docs: `https://aurora-production-b051.up.railway.app/api/docs`. The deployment reflects the full ten-epic implementation, including Epic 10's AI endpoints. The Railway Postgres instance uses the `aurora_app` non-superuser role (NOBYPASSRLS), making tenant isolation production-verified. A `seed:demo` script populates the full demo scenario (brand Marina, agency Renata, 30 qualified creators, an active campaign with a shortlist) used in the banca presentation.

## 9. Conclusion

Across seven formally tracked sprints, Aurora delivered a ten-epic implementation, 523 passing backend tests (87 test files), 218 passing frontend tests (49 test files), 68 ADRs, ten epic-level reviewer summaries, and a production deployment with proven tenant isolation. The product-side thesis — mid-market pool buying with creators treated as a retained customer base — was validated against primary field research, not only desk research. The technical execution demonstrates a consistent, disclosed process (ADR before implementation, independent QA, independent review) rather than an undocumented one.

Tenant isolation, the project's most consequential security property, is now proven: confirmed in production on 2026-11-04 by switching the Railway connection role, then verified live with symmetric 404 responses on cross-tenant resource access.

The remaining open defects from Section 7 (campaign activation, creator-decline, audience-dimension matching) are pre-disclosure design limitations, not undiscovered regressions.

## References

Aurora Project Team. (2026). *Aurora's business analysis*. Internal document, Aurora project.

Aurora Project Team. (2026). *Aurora's product requirements*. Internal document, Aurora project.

Aurora Project Team. (2026). *Aurora's architecture*. Internal document, Aurora project.

Aurora Project Team. (2026). *Implementation: agent pipeline, epics delivered, and how to run them*. Internal document, Aurora project.

Aurora Project Team. (2026). *E1 through E10: epic review summaries*. Internal documents, Aurora project.

Aurora Project Team. (2026). *ADR-0001 through ADR-0068*. Internal architecture decision records, Aurora project.

Aurora Project Team. (2026). *Tenant context engagement and RolesGuard fail-closed fix: summary*. Internal remediation review, Aurora project.

Kantar IBOPE Media. (2025). *Brazilian advertising media investment report*.

PostgreSQL Global Development Group. (2024). *Row security policies*. PostgreSQL 16 documentation. https://www.postgresql.org/docs/16/ddl-rowsecurity.html
