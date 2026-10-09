# Aurora Backend

NestJS API for Aurora. Modules: `auth`, `pricing`, `brand-profile`, `invitation`, `workspace`, `agency`, `campaign`, `matching`, `audit`, `jobs`.

For what this project is, how each module maps to an epic, and how to run and test the full stack (this backend plus the frontend and the Postgres/Redis containers), see [docs/implementation.md](../docs/implementation.md) at the repository root.

## Quick reference

```bash
cp .env.example .env
npm install
npx tsx src/database/run-migrations.ts
npm run start:dev        # http://localhost:3001/v1, Swagger at /api/docs

npx vitest run            # tests
npm run lint
```
