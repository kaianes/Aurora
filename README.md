<div align="center">

# Aurora ✦

**Technology that turns pools of nano and micro creators into a buyable media asset**

A brand sets a budget, an audience, and a message once. Aurora handles matching, briefings, brand safety, and paying every creator in the pool.

[![Live demo](https://img.shields.io/badge/demo-aurora--kaiane.vercel.app-00C4B4?style=flat-square)](https://aurora-kaiane.vercel.app)
[![API docs](https://img.shields.io/badge/API-Railway-9B72E6?style=flat-square)](https://aurora-production-b051.up.railway.app/api/docs)
[![License](https://img.shields.io/badge/license-MIT-D45FA0?style=flat-square)](LICENSE)

</div>

---

## Why Aurora exists

Influencer marketing in Brazil is a R$1.6 billion market growing at 23% a year — but it is entirely concentrated in enterprise. The minimum ticket on existing platforms reaches R$50k, locking out the 10.9 million small and mid-sized businesses that could benefit from creator marketing.

The barrier is not access: it is **operational**. Each creator requires an individual briefing, deadline tracking, content review, and a separate payment. Multiply that by hundreds of nano and micro creators and no team can manage it without a system.

Aurora solves this by treating a curated pool of creators as a **media unit that a brand plans and buys as a whole**.

---

## The solution

<p align="center">
  <img src="./docs/images/aurora-what-it-is.png" alt="What Aurora is" width="680" />
</p>

| | |
|---|---|
| **Curated pool as a product** | The brand buys a validated set of creators instead of negotiating one by one. One budget, one invoice, one result. |
| **AI as support — humans always decide** | A four-dimension fit score ranks the right creators. Claude checks brand safety before any publication. The team approves or vetoes. |
| **Creators as partners** | Structured briefing, payment confirmed before publishing, their own portal. A good creator experience retains the ecosystem. |
| **White-label for agencies** | The agency delivers the full operation under its own brand. More clients without hiring more people. |

---

## What was built

Ten epics delivered end to end, covering the full campaign lifecycle:

- **Epic 1** — Access and Onboarding (auth, tenant isolation, RBAC, workspace, invitations, agency client management)
- **Epic 2** — Campaign Planning and Pool Buying (budget, async quoting, confirmed pool price, templates)
- **Epic 3** — Creator Matching and Curation (four-dimension fit score, shortlist, exclusions, agency override)
- **Epic 4** — Brand Safety (per-campaign rules, AI-assisted content check, human review in the loop)
- **Epic 5** — Briefing and Content Workflow (structured briefing, approval cycle with stated revision reasons)
- **Epic 6** — Payments and Financial Transparency (consolidated invoice, itemized per-creator breakdown)
- **Epic 7** — Analytics and Reporting (dashboard by creator and by pool, exportable reports)
- **Epic 8** — Creator Recruitment and Growth (self-registration, media kit, social linking, reputation history)
- **Epic 9** — Agency Multi-Client Operations (white-label branding, client context selector, shareable report links)
- **Epic 10** — AI Creator Demo (live Claude API integration across fit score explanations, brand safety semantic check, and creator briefing assistant)

---

## Stack

| Layer | Technology |
|---|---|
| Backend | NestJS · TypeScript · PostgreSQL 16 · Redis |
| Frontend | React · Vite · TypeScript |
| AI | Claude (Anthropic) — brand safety and fit score |
| Infrastructure | Railway (API) · Vercel (frontend) · GitHub Actions CI |

---

## Business documentation

| Document | Contents |
|---|---|
| [Market analysis](docs/business-analysis.md) | Creator economy, Porter's Five Forces, SWOT, Gap Analysis, Personas, Revenue model |
| [Product requirements](docs/product-requirements.md) | User journeys, 47 user stories, 60 FRs, 36 NFRs |
| [Architecture](docs/architecture.md) | Design decisions, ATAM, security, DevOps |
| [Business pitch](docs/pitch/pitch-deck.html) | Interactive deck — market, solution, demo, next steps |

---

## About

Software Engineering project developed at [Inteli — Institute of Technology and Leadership](https://www.inteli.edu.br/).

**Author:** Kaiane Souza Cordeiro · kaiane.cordeiro@sou.inteli.edu.br
