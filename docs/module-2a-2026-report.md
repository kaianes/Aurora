# Aurora — Module 2A2026 Project Report

**Author:** Kaiane Souza Cordeiro
**Institution:** Inteli
**Period covered:** Sprints 1 through 5 (business analysis, product requirements, and implementation of Epics 1 through 9), plus a post-Sprint-5 remediation pass
**Date:** October 25, 2026
**Repository tag at time of writing:** `sprint-5`

## 1. Executive Summary

Aurora is a creator-media infrastructure platform for the mid-market: it lets a brand treat a curated pool of nano and micro creators as a single media unit that can be planned, bought, and reported on like paid media, while treating creators themselves as customers rather than anonymous supply. The project moved from pure market research (Sprint 1) through business analysis and a full product requirements specification (Sprints 2–3) into a nine-epic implementation (Sprints 4–5 and beyond), built end to end with a NestJS/PostgreSQL backend and a React/Vite frontend, using a repeatable agent pipeline (product-analyst → architect → backend-dev/frontend-dev → QA → reviewer) for every epic.

By the `sprint-5` tag, all nine planned epics are merged to `main`: Access and Onboarding, Campaign Planning and Pool Buying, Creator Matching and Curation, Brand Safety, Briefing and Content Workflow, Payments and Financial Transparency, Analytics and Reporting, Creator Recruitment and Growth, and Agency Multi-Client Operations. The cumulative automated suite stands at 518 backend tests and 208 frontend tests, all passing, independently re-verified rather than taken on faith from any single commit message.

This report is written in the same spirit the project's own epic summaries use: it states what was built, cites the evidence, and names what is still broken or unverified as plainly as what works. A same-day remediation pass closed the single most-repeated critical finding across every one of the nine epic reviews (row-level security never actually engaged at runtime) and a related authorization bypass, but surfaced a new, unconfirmed, potentially more serious hypothesis about the database role Aurora has always connected as — disclosed in full in Section 7.

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
| Post-5 (this report) | Epics 4 through 9 built; tenant-isolation remediation; repository hygiene pass | Not yet formally graded |

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

**Epic 9 — Agency Multi-Client Operations.** Client-context switching, template copying across clients, a white-label branding profile, an audit-log viewer, and a token-gated public share link for client reports. Its own review found and fixed a cross-tenant IDOR in that share-link mechanism and a React Query cache-key staleness bug before merge. 508 backend / 208 frontend tests at merge — the project's final cumulative automated total at the close of the nine-epic roadmap.

## 7. Known Issues and Technical Debt

This section exists because the project's own reviewing convention treats an undisclosed defect as worse than a disclosed one. Every item below was independently verified against the current codebase, not copied from a prior summary without re-checking.

**Resolved in this reporting period's remediation pass.** `TenantContextMiddleware`, the component meant to set `app.current_account_id` for every RLS policy to key on, was never registered in `AppModule` and — a deeper problem this period's own architectural review surfaced — could never have worked as middleware at all, since NestJS runs middleware before guards, and the account id was only resolved inside a guard. The fix (ADR-0063) replaces it with a `NestInterceptor`, registered via `APP_INTERCEPTOR`, that pins each request's downstream database calls to one `AsyncLocalStorage`-scoped transaction using the `typeorm-transactional` library, requiring no change to any of the 70 files using the standard repository-injection pattern. A related bug (ADR-0064): `RolesGuard` returned `true` whenever it could not resolve an account id, which let a creator-portal JWT reach any brand- or agency-scoped route with no role check and no audit trail; the fix adds an explicit `@CreatorPortalRoute()` decorator at all 13 legitimate call sites and fails closed everywhere else. Both fixes were independently re-verified clause by clause against their governing ADRs, with 518/518 backend tests passing and a clean build.

**Not yet proven, despite being correctly implemented.** The actual claim both fixes make — that PostgreSQL itself now returns only the correct tenant's rows under real connection-pool reuse — requires a live Postgres instance to verify and cannot be proven by a mocked unit test. No Docker access was available in the environment this remediation was built in, so this remains, in the governing ADR's own words, "specified and unit-tested, but not proven."

**A new, unconfirmed, and potentially more serious hypothesis.** `docker-compose.yml` configures Postgres with only a `POSTGRES_USER` environment variable and no further role customization; no migration anywhere creates a separate, non-superuser application role. The official Postgres Docker image's documented behavior makes that user the cluster's actual bootstrap superuser when nothing else customizes it, and PostgreSQL superusers carry the `BYPASSRLS` attribute by default — which causes every row-level security policy, including `FORCE ROW LEVEL SECURITY` ones, to be ignored entirely, independent of whether the application sets its session variable correctly. If Aurora has always connected as this same superuser, every RLS policy written since Epic 1 has been structurally inert for a reason that has nothing to do with this period's fix. This has not been checked against a live instance and is recorded as an open hypothesis, not a settled fact; the verifying query (`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'aurora';`) is specified in the remediation's own review summary and should be run before anyone treats tenant isolation as proven.

**Other defects confirmed still open, independent of the above.** A creator cannot decline a campaign opportunity: `OpportunityService.decline` updates a `campaign_shortlist_entry` row that, by the time any opportunity exists, is always locked, and a database trigger rejects that exact update. No campaign can reach its first `ACTIVE` state: only the `resume()` method (from `PAUSED`) ever sets that state, and no `CONFIRMED → ACTIVE` transition exists anywhere in the codebase, which also makes `pause()` unreachable through the normal lifecycle. Three of the matching engine's four audience-targeting dimensions (geography, age range, gender) unconditionally report a match regardless of the creator's actual data, because the minimal creator entity carries none of that data — confirmed in a live test to misclassify ten of thirty shortlisted creators as skincare-relevant when they were fashion creators. No CI pipeline (GitHub Actions or GitLab CI) has ever been committed, despite being named in the architecture document and required by every sprint evaluation since Sprint 4. The frontend's Vitest module alias is hardcoded to the author's own local filesystem path, which breaks the test suite on any other machine, including any future CI runner. The backend's `tsconfig.json` carries two TypeScript options removed by the current compiler version, breaking type-aware lint. No creator seed data exists anywhere in the repository, so a fresh installation produces empty shortlists. No real-Postgres integration-test harness exists at all, which is also why none of the defects above involving a live database trigger or RLS policy were ever caught by the existing (fully mocked) automated suite.

**Repository hygiene.** Three named interview-analysis PDFs and a demo account password were removed from the current tree in this period, and the demo account passwords were rotated on the live deployment, but the prior git history on all three configured remotes — including the public GitHub mirror — still carries that material in earlier commits; no history rewrite has been performed. The `README.md`'s "Project Status" section and its epic-by-epic write-ups still describe only Epics 1 through 3, despite the repository containing all nine; this is a known, as-yet-uncorrected documentation gap at the time of this report.

## 8. Deployment

A live demo runs on Railway (backend, Postgres, Redis) and Vercel (frontend static site), both deploying directly from the public GitHub mirror rather than either institutional GitLab repository. The deployed backend's API surface was independently checked against its own Swagger documentation and found to expose only around 50 routes, covering Epics 1 through 3 and part of Epic 9 (agency/client management); no route exists for brand safety, content workflow, payments, full analytics, or the Epic 9 client-report share link added since. The live environment has not been redeployed to reflect Epics 4 through 9 or this period's remediation, and should not be treated as representative of the current `main` branch's functional scope.

## 9. Conclusion and Next Steps

Across five formally graded sprints and a substantial, independently-verified implementation effort, Aurora delivered its full originally-scoped nine-epic roadmap, 518 passing backend tests and 208 passing frontend tests, 64 ADRs, and nine epic-level review summaries that this report's own citations rely on rather than restate uncritically. The product-side thesis — mid-market pool buying with creators treated as a retained customer base — was validated against primary field research, not only desk research, and the technical execution demonstrates a consistent, disclosed process (ADR before implementation, independent QA, independent review) rather than an undocumented one.

The project's most consequential unresolved risk, by a clear margin, is the one named in Section 7: whether row-level security has ever actually been enforced by the database at all, independent of this period's own correctly-implemented application-layer fix. Resolving that single open question — a one-line SQL check once a live Postgres instance is reachable — should be the immediate next step before any further claim about tenant isolation is made in a future report or a live evaluation. After that: run the real-Postgres integration suite the remediation's own governing ADR specifies; write the still-missing route-sweep regression test; and work through the remaining defects in Section 7 in the order of how directly they block a grader's or user's ability to exercise the product (the campaign activation and creator-decline bugs block core golden-path testing; the CI and tsconfig gaps block trustworthy automated verification of anything else that gets fixed next).

## References

Aurora Project Team. (2026). *Aurora's business analysis*. Internal document, Aurora project.

Aurora Project Team. (2026). *Aurora's product requirements*. Internal document, Aurora project.

Aurora Project Team. (2026). *Aurora's architecture*. Internal document, Aurora project.

Aurora Project Team. (2026). *Implementation: agent pipeline, epics delivered, and how to run them*. Internal document, Aurora project.

Aurora Project Team. (2026). *E1 through E9: epic review summaries*. Internal documents, Aurora project.

Aurora Project Team. (2026). *ADR-0001 through ADR-0064*. Internal architecture decision records, Aurora project.

Aurora Project Team. (2026). *Tenant context engagement and RolesGuard fail-closed fix: summary*. Internal remediation review, Aurora project.

Kantar IBOPE Media. (2025). *Brazilian advertising media investment report*.

PostgreSQL Global Development Group. (2024). *Row security policies*. PostgreSQL 16 documentation. https://www.postgresql.org/docs/16/ddl-rowsecurity.html
