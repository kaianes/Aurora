# Aurora E1 — Setup Guide

Access and Onboarding — everything you need to run the project locally.

## Prerequisites

- **Node.js 20+** — already installed via `fnm`
- **Docker + Docker Compose** — for PostgreSQL 16 and Redis 7
- Free ports: `5432` (Postgres), `6379` (Redis), `3001` (API), `5173` (Frontend)

## Step-by-step setup

1

**Start PostgreSQL and Redis**

```
cd ~/Documents/Aurora
docker compose up -d
```

This creates the `aurora-postgres` and `aurora-redis` containers with healthchecks.

2

**Configure the backend**

```
cd backend
cp .env.example .env
npm install
```

The `.env.example` ships with development defaults. No changes needed for local use.

3

**Run migrations**

```
npx typeorm migration:run -d src/database/data-source.ts
```

Creates all tables, constraints, RLS policies, and the audit log immutability trigger.

4

**Start the backend**

```
npm run start:dev
```

API available at `http://localhost:3001/v1`

5

**Start the frontend** (in a separate terminal)

```
cd ~/Documents/Aurora/frontend
npm install
npm run dev
```

App available at `http://localhost:5173`

**Note:** Emails are printed to the console (backend stdout) during development. Check the backend terminal for verification and invitation links.

## Routes and features

| Route | Access | Description |
| --- | --- | --- |
| `/pricing` | public | Pricing page with Brand/Agency toggle |
| `/register` | public | Sign-up with workspace type selection |
| `/verify-email` | public | Email verification (link from email) |
| `/login` | public | Login with MFA support |
| `/invitations/accept` | public | Accept team invitation |
| `/app/brand-profile` | auth | Brand profile editor (logo, tone, guidelines) |
| `/app/team` | auth | Manage team, invitations, and roles |
| `/app/clients` | agency | Agency client account list (limit: 10) |
| `/app/clients/:id` | agency | Client detail + operator management |

## Usage flows

### As a brand (Marina)

1. Visit `/pricing` — see plans without logging in
2. Click "Get started" or go to `/register`
3. Select **Brand**, fill in name, email, password, and brand name
4. Verify your email (check the backend console for the verification link)
5. Log in at `/login`
6. Set up the brand profile at `/app/brand-profile` (can save as draft)
7. Invite team members at `/app/team` (brand_manager or brand_analyst)

### As an agency (Renata)

1. Sign up at `/register` selecting **Agency**
2. After verifying email and logging in, go to `/app/clients`
3. Create client accounts (up to 10 on the pilot plan)
4. Optionally copy templates from another client when creating
5. Manage operators at `/app/clients/:id`

## Roles and permissions

| Role | Workspace | Can do |
| --- | --- | --- |
| `brand_owner` | Brand | Everything: profile, campaigns, invite team, change roles |
| `brand_manager` | Brand | Edit profile, create campaigns. Cannot invite. |
| `brand_analyst` | Brand | Read-only |
| `agency_admin` | Agency | Everything: clients, team, operators |
| `agency_operator` | Agency | Only assigned client accounts |

## API endpoints

**25 endpoints** total, all under `/v1`:

### Auth (7)

`POST /auth/register` · `POST /auth/verify-email` · `POST /auth/resend-verification`\
`POST /auth/login` · `POST /auth/refresh`\
`POST /auth/mfa/setup` · `POST /auth/mfa/confirm`

### Pricing (1)

`GET /pricing` public

### Brand Profile (4)

`POST /brand-profiles` · `PATCH /brand-profiles/:id`\
`GET /brand-profiles/current` · `POST /brand-profiles/:id/logo`

### Invitations (5)

`POST /invitations` · `POST /invitations/:id/resend`\
`GET /invitations` · `POST /invitations/accept` · `DELETE /invitations/:id`

### Workspace (4)

`GET /workspaces/current` · `GET /accounts/:id/members`\
`PATCH /accounts/:id/members/:userId` · `DELETE /accounts/:id/members/:userId`

### Agency (4)

`POST /agency/clients` · `GET /agency/clients`\
`POST /agency/clients/:id/operators` · `DELETE /agency/clients/:id/operators/:userId`

## Project structure

```
Aurora/
├── docker-compose.yml          # PostgreSQL 16 + Redis 7
├── backend/
│   ├── .env.example
│   ├── src/
│   │   ├── auth/               # 7 endpoints (register, login, MFA)
│   │   ├── pricing/            # GET /pricing
│   │   ├── brand-profile/      # CRUD + logo upload
│   │   ├── invitation/         # Invitations with 7-day expiry
│   │   ├── workspace/          # Members and roles
│   │   ├── agency/             # Clients and operators
│   │   ├── audit/              # Immutable audit log
│   │   ├── jobs/               # Email queue + expiry crons
│   │   ├── common/             # Guards, RLS middleware, filters
│   │   └── database/
│   │       ├── entities/       # 9 TypeORM entities
│   │       └── migrations/     # Schema + RLS + triggers
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── pages/              # 9 pages (auth + app)
│   │   ├── components/ui/      # Button, Input, Card, etc.
│   │   ├── contexts/           # AuthContext (JWT + workspace)
│   │   ├── lib/                # API client + role helpers
│   │   └── types/              # TypeScript types for APIs
│   └── package.json
└── docs/
    ├── product-requirements.md
    ├── architecture/
    │   └── e1-access-onboarding.md
    ├── adr/                    # 4 ADRs
    └── epics/e1-access-onboarding/
        ├── stories.md
        └── summary.md
```

## Running tests

```
# Backend (17 tests)
cd backend && npx jest

# Frontend (9 tests)
cd frontend && npx vitest run
```

**Coverage:** All 5 stories tested with normal, hard, and failure scenarios. 26 tests total, all passing.

## Tech debt (tracked for future sprints)

| # | Item | Impact |
| --- | --- | --- |
| 1 | Breached-password check not implemented | Low (pilot only) |
| 2 | MFA secret persisted before confirmation | Low |
| 3 | MFA secrets not encrypted at application level | Medium |
| 4 | Pricing data hardcoded instead of DB + Redis | Low |
| 5 | Invitation-accepted email has empty `to` field | Low |
| 6 | pt-BR strings not externalized into keyed resources | Low |
| 7 | `GET /agency/clients` lacks cursor-based pagination | Low (pilot cap: 10) |