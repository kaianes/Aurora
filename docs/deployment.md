# Deployment: Live Demo on Railway + Vercel

This is a step-by-step guide to put a working, link-shareable demo of Aurora online: backend + Postgres + Redis on [Railway](https://railway.app), frontend as a static site on [Vercel](https://vercel.com). Both have free tiers; Railway's free usage is trial credit, not permanent (see note at the end).

This guide assumes the `feature/e3-creator-matching-curation` branch (the one with E1+E2+E3) is what you want live. If the branch has since merged, use `main` instead.

## 1. Backend + Postgres + Redis on Railway

1. Go to [railway.app](https://railway.app) and sign up (GitHub login is the fastest path).
2. **New Project** → **Deploy from GitHub repo** → pick `kaianes/Aurora`.
3. Railway will try to build the whole repo as one service — stop it from deploying yet. Click into the new service, go to **Settings**, and set:
   - **Root Directory:** `backend`
   - **Branch:** `feature/e3-creator-matching-curation`
   - Railway auto-detects the build/start commands from `backend/railway.toml` (already in the repo) — it installs, runs `nest build`, runs migrations, then starts `node dist/main`.
4. In the same project, click **+ New** → **Database** → **Add PostgreSQL**. Click **+ New** → **Database** → **Add Redis**.
5. Back on the backend service → **Variables** tab, add these, referencing the Postgres/Redis plugins Railway just created (type `${{` in the value field and Railway autocompletes the reference):

   ```
   DB_HOST=${{Postgres.PGHOST}}
   DB_PORT=${{Postgres.PGPORT}}
   DB_USERNAME=${{Postgres.PGUSER}}
   DB_PASSWORD=${{Postgres.PGPASSWORD}}
   DB_DATABASE=${{Postgres.PGDATABASE}}
   DB_SYNCHRONIZE=false
   DB_LOGGING=false

   REDIS_HOST=${{Redis.REDISHOST}}
   REDIS_PORT=${{Redis.REDISPORT}}

   JWT_SECRET=<generate a random 32+ char string>
   JWT_REFRESH_SECRET=<a different random 32+ char string>
   MFA_ENCRYPTION_KEY=<another random 32-byte string>

   PORT=3001
   FRONTEND_URL=<fill in after step 2, e.g. https://aurora-demo.vercel.app>

   EMAIL_PROVIDER=console
   EMAIL_FROM=noreply@aurora.com.br

   S3_BUCKET=aurora-assets
   S3_REGION=sa-east-1
   S3_ACCESS_KEY_ID=unused
   S3_SECRET_ACCESS_KEY=unused
   S3_ENDPOINT=http://unused
   S3_PUBLIC_URL=http://unused
   ```

   Logo upload is the only feature that touches S3; it's not wired to a real bucket in this demo and is a known limitation (see `docs/implementation.md`), not something to fix for a grading demo.

6. **Deploy**. Once it's live, Railway gives you a public URL like `https://aurora-backend-production.up.railway.app`. Copy it — you'll need it for the frontend's `VITE_API_BASE_URL` (note the backend's global prefix: the URL to use is `.../v1`, e.g. `https://aurora-backend-production.up.railway.app/v1`).

## 2. Frontend on Vercel

1. Go to [vercel.com](https://vercel.com) and sign up (GitHub login).
2. **Add New** → **Project** → import `kaianes/Aurora`.
3. Set:
   - **Root Directory:** `frontend`
   - **Branch:** `feature/e3-creator-matching-curation`
   - **Framework Preset:** Vite (auto-detected)
4. **Environment Variables** → add:
   ```
   VITE_API_BASE_URL=https://<your-railway-backend-url>/v1
   ```
5. **Deploy**. Vercel gives you a URL like `https://aurora-<hash>.vercel.app`. `frontend/vercel.json` (already in the repo) handles client-side routing, so deep links like `/app/campaigns` work on refresh.
6. Go back to Railway's backend service → **Variables** → set `FRONTEND_URL` to this Vercel URL, so CORS allows the frontend to call the API. Redeploy the backend for the change to take effect.

## 3. Verify

- Visit the Vercel URL, go to `/pricing` — should load with no login.
- Register a Brand account at `/register`. Since `EMAIL_PROVIDER=console`, the verification link doesn't arrive by email — check Railway's backend service **Logs** tab for the printed verification URL and open it manually.
- Log in and walk through a campaign (see `docs/implementation.md` section 8 for the full manual walkthrough).

## Notes and limits for a grading demo

- **Railway's free tier is trial credit**, not indefinite. It's enough for a demo window (grading period), but don't expect it to stay up forever without adding a payment method. If it expires before grading, redeploying from this guide takes about 10 minutes.
- **Vercel's free tier is permanent** for projects like this (no sleep, no credit card needed).
- The backend does **not** sleep on Railway's trial plan, so there's no cold-start delay like a Render free-tier demo would have.
- Email, logo upload (S3), payments, and anything epics E4-E9 would cover are out of scope for this demo, same as for local development — see `docs/implementation.md` for the full list of known limitations.
