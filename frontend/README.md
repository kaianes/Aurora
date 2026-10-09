# Aurora Frontend

React/Vite app consuming the Aurora API: public pages (pricing, register, login), protected app pages (brand profile, team, clients, campaigns, shortlists, exclusions, templates), and a separate `creator-portal` route tree for the creator-facing opportunity flow.

For what this project is and how to run and test the full stack (this frontend plus the backend and the Postgres/Redis containers), see [docs/implementation.md](../docs/implementation.md) at the repository root.

## Quick reference

```bash
npm install
npm run dev                # http://localhost:5173

npx vitest run              # tests
npm run build
npm run lint
```
