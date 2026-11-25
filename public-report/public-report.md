# Aurora — Public Report

**Kaiane Souza Cordeiro** · Engenharia de Software · [Inteli](https://www.inteli.edu.br/)

---

## Executive Summary

Aurora is a B2B SaaS platform that turns pools of nano and micro creators into a single, manageable media unit. It addresses a structural gap in influencer marketing: mid-market brands that have outgrown spreadsheet-based campaigns but cannot justify enterprise platform contracts. Over nine sprints and three modules, the project went from business discovery to a live, multi-tenant production platform with AI integration.

---

## Module 1 — Business Discovery (Sprints 1–3)

### Problem Statement

Brands know that nano and micro creators convert better than large influencers — engagement rates of 8.7% versus 1.5% for macro accounts. The challenge is using them at scale. Running a campaign through hundreds of small creators means managing hundreds of separate briefings, delivery deadlines, payments, and content reviews simultaneously. For most marketing teams, that is unmanageable by hand.

Large enterprise platforms (Creator Ads, Squid, CreatorIQ) have solved this for big brands. None serve the mid-market effectively. The gap is structural: a large segment of brands and agencies with real budgets, but no suitable tool.

### Market Research (Sprint 1)

- Global creator economy estimated at $250–320 billion in 2025–2026, projected toward $1 trillion by 2033.
- Nano creators (1K–10K followers) consistently outperform large influencers on engagement: 3.86% average on Instagram versus 1.21% for accounts above 1M followers.
- By 2026, micro and nano influencers are projected to capture 45.5% of total influencer marketing spend.
- Brazil hosts over 500,000 creators with at least 10,000 followers. Brazilian nano creators show 8.7% average engagement rate against 1.5% for macro influencers.
- 81% of Brazilians have purchased something recommended by an influencer.

### Strategic Analysis (Sprint 2)

**Porter's Five Forces** revealed moderate supplier power, low buyer switching costs short-term, and significant barriers to entry once a creator network reaches critical mass.

**SWOT** identified Aurora's core strengths as mid-market focus and creator-first design; main weakness as early-stage brand recognition; opportunity as the structural budget shift toward nano/micro; principal threat as enterprise player expansion into the mid-market.

**Gap Analysis** confirmed two open market positions: mid-market accessibility and treating creators as customers rather than anonymous supply. These became Aurora's primary design principles.

Three personas were defined: **Marina** (brand media manager), **Duda** (nano creator, 15k followers), and **Renata** (agency partner managing multiple brand clients).

### Product Requirements (Sprint 3)

Journey maps for each persona identified key friction points that became the product's ten epics. The sprint produced 47 user stories, 60 functional requirements, and 36 non-functional requirements covering security, performance, accessibility, and LGPD compliance.

---

## Module 2 — Architecture and Development (Sprints 4–6)

### Architecture Decisions

Before development began, 68 Architecture Decision Records (ADRs) were produced. Two principles guided every decision: **tenant isolation** (no entity can access another tenant's data) and **financial integrity** (payout figures are immutable; every financial record is append-only).

### Epic 1 — Access and Onboarding (Sprint 4)

Brand registration with email verification and MFA. Agency onboarding with multi-client workspaces. Role-based access control enforced globally: every API endpoint requires authentication, every route checks the caller's role, and every access denial is logged.

### Epics 2 & 3 — Campaigns and Creator Matching (Sprint 5)

**Campaign Planning:** brands define objectives, budget, timeline, and audience. Aurora computes pool composition and locks pricing at confirmation. Campaigns follow a defined lifecycle (draft → confirmed → active → completed → cancelled).

**Creator Matching:** when a brand triggers a shortlist, the system scores creators across four dimensions (audience fit, engagement rate, authenticity, historical reliability). Brands inspect detailed data before approving or rejecting candidates. Agencies can override with their own network. Creators see projected earnings (gross, commission, net) before accepting.

### Epics 4–9 — Operations and Financial Infrastructure (Sprint 6)

- **Brand Safety:** two-tier moderation — rule-based screen plus semantic review. Human review supersedes any automated verdict.
- **Briefing and Content Workflow:** structured briefings, creator Q&A, content submission and approval. Confirmed publication triggers payout obligation immediately.
- **Payments:** immutable payout records created atomically with publication confirmation. Creator statements, consolidated brand invoicing, agency billing.
- **Analytics:** performance metrics, cost efficiency, campaign ROI, reallocation scoring.
- **Creator Recruitment:** onboarding with audience verification, invitation-based recruitment, LGPD-compliant opt-out.
- **Agency Operations:** cross-client visibility, template library, white-label configuration, consolidated billing.

---

## Module 3 — Quality, AI, and Production (Sprints 7–9)

### Advisor Remediation and Testing (Sprint 7)

An independent technical review identified two critical findings:

1. **Tenant isolation:** row-level security policies were defined correctly but never activated at runtime. All separation relied on application-level filtering alone.
2. **No real database testing:** the entire test suite ran against in-memory mocks, meaning database constraints and RLS policies were never verified.

Both were resolved:
- The tenant-isolation middleware was rewritten to set database session variables within a real transaction. Verified in production: cross-tenant requests return 404.
- An end-to-end testing harness was built against a real PostgreSQL instance. This also uncovered ~25 additional RLS policies with unsafe cast patterns, all corrected.

### Epic 10 — AI Integration (Sprint 8)

Four AI capabilities were integrated using the Claude API:

- **Briefing Q&A streaming:** creators ask questions about brand briefs and receive real-time streamed responses.
- **Fit reasoning:** each shortlisted creator gets an AI-generated explanation of why they were selected.
- **Brand safety semantic check:** the second moderation tier is now backed by Claude for semantic content review.
- **Animated creator onboarding:** a four-step analysis sequence communicates what the platform evaluates (audience authenticity, engagement, composition, overall score).

A seed dataset creates a walkable demo scenario: 10 creators, 2 brands, 1 agency, 2 campaigns with pre-scored shortlists, and 3 content submissions in distinct safety states.

### Production Deployment (Sprint 9)

The platform was deployed to production (backend on Railway, frontend on Vercel) with CI running the full test suite on every push. Final adjustments, dry runs, and pitch deck preparation.

---

## Product Summary

Aurora's production system comprises:

| Component | Description |
|---|---|
| Multi-tenant API | Authentication, RBAC, row-level security enforced at the database layer |
| Web application | Full campaign lifecycle for brands, creators, and agencies |
| Content safety pipeline | Rule-based screening + AI semantic review (Claude) |
| Payment system | Immutable financial records, consolidated invoicing, tax documentation |
| Analytics | Performance and cost efficiency tracking across campaigns |
| AI creator portal | Real-time briefing Q&A, fit scoring, animated onboarding |
| 10 product epics | Complete lifecycle from registration to payment and analytics |

---

## Live Demo

| | |
|---|---|
| **Frontend** | [aurora-kaiane.vercel.app](https://aurora-kaiane.vercel.app) |
| **API Docs** | [aurora-production-b051.up.railway.app/api/docs](https://aurora-production-b051.up.railway.app/api/docs) |
| **Pitch Deck** | [docs/pitch/pitch-deck.html](docs/pitch/pitch-deck.html) |
