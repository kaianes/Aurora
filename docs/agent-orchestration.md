# Agent Orchestration

Aurora was built by a fixed pipeline of specialized Claude Code agents, one per role, instead of a single agent doing everything end to end. This document explains how that pipeline works, what each agent does, and what it produced.

---

## Why a pipeline instead of one agent

Each agent has a narrow role, a fixed set of tools, and a single kind of output. Splitting the work this way keeps every stage independently auditable: the product-analyst's stories can be reviewed and approved before any architecture exists; the architect's contracts can be approved before any code is written. Two human gates enforce this — no stage begins until the previous stage's output is approved.

A single agent doing all five roles at once would skip those gates, mix documentation with code generation, and make it impossible to verify that the design came before the implementation.

---

## The pipeline

| Stage | Agent | Input | Output | Gate |
|---|---|---|---|---|
| 1 | `product-analyst` | Approved epic from `docs/product-requirements.md` | `docs/epics/<epic>/stories.md` — user stories with Given/When/Then acceptance criteria | Human approves stories before stage 2 |
| 2 | `architect` | Approved stories | `docs/architecture/<epic>.md` (data model, API contracts) + `docs/adr/NNNN-*.md` (one ADR per nontrivial decision) | Human approves design before stage 3 |
| 3a | `backend-dev` | Approved architecture and ADRs | NestJS modules, TypeORM entities, API endpoints — one story or small batch at a time, on the feature branch | `qa` must pass the story |
| 3b | `frontend-dev` | Approved architecture and ADRs | React pages and components consuming the approved API contracts | `qa` must pass the story |
| 4 | `qa` | Implemented story | Automated tests covering normal, edge, and failure cases; pass/fail reported back to the owning dev | Up to 2 fix-and-retest rounds before escalation |
| 5 | `reviewer` | Full epic diff + ADRs + architecture doc + qa results | `docs/epics/<epic>/summary.md` — APA-style review with deviations and coverage gaps flagged | Human approves before merge |

*ADR = Architecture Decision Record.*

---

## The agents

Each agent's full prompt lives in `.claude/agents/<name>.md` and is the actual instruction set used — not a summary of it.

**`product-analyst`** — reads the product requirements and writes user stories with Given/When/Then acceptance criteria. Has access only to documentation tools (Read, Write, Edit, Grep, Glob). Never writes source code.

**`architect`** — takes the approved stories and produces the technical design: data model, API contracts, ADRs for every nontrivial decision. Has access to documentation tools and web search for reference. Never writes source code.

**`backend-dev`** — implements API endpoints and database schema strictly following the architect's contracts. Has access to Bash, Read, Write, Edit, Grep, Glob. Never touches frontend code and never writes documentation.

**`frontend-dev`** — builds UI pages consuming the approved API contracts, following Aurora's brand system. Same tool set as `backend-dev`. Never touches backend code and never writes documentation.

**`qa`** — writes and runs automated tests from the story's acceptance criteria. May only create or edit test files. A failing test is returned to the owning dev to fix — `qa` never edits source code.

**`reviewer`** — reads the full epic diff, the ADRs, the architecture document, and the qa results, then writes the epic's summary. Has read-only access (Read, Grep, Glob, Bash for running tests). Never edits source code or test files.

---

## Guardrails

- Documentation agents (`product-analyst`, `architect`, `reviewer`) never write source code.
- Implementation agents (`backend-dev`, `frontend-dev`) never write documentation and never touch each other's code.
- `qa` may only create or edit test files.
- Nothing merges without a human-approved `reviewer` summary.

---

## What was produced

Ten epics, each following the full pipeline:

| Epic | Name | Stories | Architecture | ADRs | Summary |
|---|---|---|---|---|---|
| E1 | Access and Onboarding | [stories](epics/e1-access-onboarding/stories.md) | [architecture](architecture/e1-access-onboarding.md) | 0001–0004 | [summary](epics/e1-access-onboarding/summary.md) |
| E2 | Campaign Planning and Pool Buying | [stories](epics/e2-campaign-planning-pool-buying/stories.md) | [architecture](architecture/e2-campaign-planning-pool-buying.md) | 0005–0010 | [summary](epics/e2-campaign-planning-pool-buying/summary.md) |
| E3 | Creator Matching and Curation | [stories](epics/e3-creator-matching-curation/stories.md) | [architecture](architecture/e3-creator-matching-curation.md) | 0011–0019 | [summary](epics/e3-creator-matching-curation/summary.md) |
| E4 | Brand Safety | [stories](epics/e4-brand-safety/stories.md) | [architecture](architecture/e4-brand-safety.md) | 0020–0027 | [summary](epics/e4-brand-safety/summary.md) |
| E5 | Briefing and Content Workflow | [stories](epics/e5-briefing-content-workflow/stories.md) | [architecture](architecture/e5-briefing-content-workflow.md) | 0028–0032 | [summary](epics/e5-briefing-content-workflow/summary.md) |
| E6 | Payments and Financial Transparency | [stories](epics/e6-payments-financial-transparency/stories.md) | [architecture](architecture/e6-payments-financial-transparency.md) | 0033–0043 | [summary](epics/e6-payments-financial-transparency/summary.md) |
| E7 | Analytics and Reporting | [stories](epics/e7-analytics-reporting/stories.md) | [architecture](architecture/e7-analytics-reporting.md) | 0044–0048 | [summary](epics/e7-analytics-reporting/summary.md) |
| E8 | Creator Recruitment and Growth | [stories](epics/e8-creator-recruitment-growth/stories.md) | [architecture](architecture/e8-creator-recruitment-growth.md) | 0049–0058 | [summary](epics/e8-creator-recruitment-growth/summary.md) |
| E9 | Agency Multi-Client Operations | [stories](epics/e9-agency-multi-client-operations/stories.md) | [architecture](architecture/e9-agency-multi-client-operations.md) | 0059–0064 | [summary](epics/e9-agency-multi-client-operations/summary.md) |
| E10 | AI Creator Demo | [stories](epics/e10-ai-creator-demo/stories.md) | [architecture](architecture/e10-ai-creator-demo.md) | 0065–0068 | [summary](epics/e10-ai-creator-demo/summary.md) |

Cumulative automated suite at final delivery: **523 backend tests** (87 files) · **218 frontend tests** (49 files) · all passing.

---

## How to run

```bash
# 1. Postgres and Redis
docker compose up -d

# 2. Backend
cd backend && cp .env.example .env && npm install
npx tsx src/database/run-migrations.ts
npm run seed:demo        # full demo scenario for the presentation
npm run start:dev        # http://localhost:3001

# 3. Frontend (separate terminal)
cd frontend && npm install
npm run dev              # http://localhost:5173
```

API documentation (Swagger) is available at `http://localhost:3001/api/docs` once the backend is running.

Note: `EMAIL_PROVIDER=console` in `.env` — verification and invitation links are printed to the backend terminal, not sent by email.

## How to test

```bash
cd backend  && npm test            # 523 unit tests
cd backend  && npm run test:e2e    # real-Postgres integration tests
cd frontend && npm test            # 218 unit tests
```
