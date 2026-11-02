# Deployment Verification Checklist

Use this after redeploying `main` to Railway + Vercel (see the rollout plan discussed 2026-11-02: Postgres role split, `DB_MIGRATION_*` vars, then switching `DB_USERNAME`/`DB_PASSWORD` to the restricted `aurora_app` role). It has two jobs: (1) prove tenant isolation actually works on the live environment, the way it now does locally, and (2) give a flow-by-flow pass over all nine epics so you know what's expected to work, what's a known limitation and not a bug, and what to report if it breaks.

**Live URLs:** frontend `https://aurora-kaiane.vercel.app`, backend API docs `https://aurora-production-b051.up.railway.app/api/docs` (adjust if either was redeployed under a different URL).

**Pre-seeded demo accounts** (passwords not in this file — ask the project author): `marina.demo.aurora@gmail.com` (brand owner), `renata.demo.aurora@gmail.com` (agency admin). For the tenant-isolation test below, register two *new* accounts instead — the test depends on two accounts that have never shared data.

---

## 1. Tenant isolation — the actual point of this deploy

This is the one section that directly proves today's fix landed. Do this first; if it fails, nothing below matters yet.

- [ ] Register Tenant A: `POST /v1/auth/register` (or the `/register` page) with a fresh email, `workspace_type: "brand"`.
- [ ] Find A's verification link in Railway's backend **Logs** tab (`EMAIL_PROVIDER=console`, so it's printed, not emailed) and open it, or call `/v1/auth/verify-email`.
- [ ] Log in as A. Confirm the response/token actually carries a non-empty `memberships` array with a real `account_id` and `account_name` — if this is empty, the `membership_self_lookup`/`account_self_lookup` fix didn't make it live.
- [ ] Repeat the three steps above for Tenant B, a second, independent new account.
- [ ] As A, create a brand profile (`POST /v1/brand-profiles` or `/app/brand-profile`). Note its `id`.
- [ ] As B, create a brand profile too. Note its `id`.
- [ ] **As B, try to `PATCH /v1/brand-profiles/{A's id}`** (with B's token and B's `X-Account-Id`). Expected: `404 PROFILE_NOT_FOUND` — the row must be invisible, not merely forbidden.
- [ ] **As A, try to `PATCH /v1/brand-profiles/{B's id}`** the same way. Expected: `404` too (symmetric).
- [ ] As A, confirm `GET /v1/brand-profiles/current` still returns A's own profile normally (the fix didn't just lock everyone out).

If any of these behave differently from expected, check Railway's **Logs** for the exact error before reporting — compare against section 3 below, since several of these exact failure modes were already seen and fixed once.

---

## 2. Per-epic walkthrough

Each item names the role needed. Skip items under roles you don't have a seeded or freshly-registered account for.

### E1 — Access and Onboarding
- [ ] `/pricing` loads with no login
- [ ] Register (brand or agency), verify email via the Railway logs link, log in
- [ ] Fill and save a brand profile at `/app/brand-profile`
- [ ] Invite a teammate with a role at `/app/team`; accept the invite
- [ ] Agency: create a client account and an operator at `/app/clients`
- **Known limitations, not bugs:** no UI page to enable MFA (endpoint-only); logo upload validates but never persists to real storage; verification/invite emails are console-log only, never real email.

### E2 — Campaign Planning and Pool Buying
- [ ] Create a campaign (budget ≥ R$2.000, geography, message, format) at `/app/campaigns/new`
- [ ] Request a quote, poll to a locked price + guaranteed pool size
- [ ] Confirm the campaign at that price
- [ ] Save as a template; instantiate a new campaign from that template
- [ ] Pause / resume / cancel a confirmed campaign
- **Known limitations:** no `CONFIRMED → ACTIVE` trigger exists, so normal activation (and therefore normal pause/resume) is unreachable except via the Epic 3 agency-override path below; automatic budget reallocation saves but never actually reallocates (no metrics feed yet).

### E3 — Creator Matching and Curation
- [ ] Generate a shortlist for a confirmed campaign at `/app/campaigns/:id/shortlist`
- [ ] Approve / reject individual creators
- [ ] Add a brand-level or campaign-level exclusion at `/app/exclusions`, confirm it only affects *future* shortlists
- [ ] Agency: override a shortlist (remove a system creator, add your own), confirm it locks the shortlist and flags a pool-shortfall warning if below guaranteed minimum
- [ ] Creator portal: accept an opportunity
- **Known limitations:** creator **cannot** decline an opportunity — this is a disclosed bug (see section 4), not new; geography/age/gender targeting always reports a match regardless of the creator's real data; commission (15%) and opportunity expiry (72h) are placeholders.

### E4 — Brand Safety
- [ ] Define/edit a safety ruleset and prohibited topics at `/app/safety/ruleset`
- [ ] View a campaign's effective ruleset (base vs. override badges)
- [ ] Creator: submit content at `/creator-portal/submissions/new`, poll to a result
- [ ] Review a flagged item in the human queue at `/app/safety/review-queue`
- [ ] View post-publication monitoring status at `/app/safety/monitoring`
- **Known limitations:** the safety check is a deterministic rule-matcher stand-in, not a real AI call; no real file upload for media — the creator pastes a URL/path string.

### E5 — Briefing and Content Workflow
- [ ] Compose and distribute a briefing at `/app/campaigns/:id/briefing`
- [ ] Creator: view the briefing, ask a question, submit a draft
- [ ] Brand: approve or reject the draft with a stated reason; confirm a new version supersedes the old one
- [ ] Creator: confirm publication with a live URL; confirm it's blocked if the draft isn't approved or the safety check hasn't cleared
- **Known limitations:** no SLA on brand's Q&A response time or on resubmission count; the live-publication-URL check is a stub that always reports "matches," not a real fetch.

### E6 — Payments and Financial Transparency
- [ ] Creator: before accepting an opportunity, see the projected gross/commission/net breakdown
- [ ] Creator: view payment history and a single payout's detail at `/creator-portal/payments`
- [ ] Brand or agency: generate a consolidated invoice at `/app/campaigns/:id/invoice`
- [ ] `aurora_operator` account: manually mark a payout settled (MFA-gated ops endpoint) — only reachable this way in this pilot
- **Known limitations:** no real PSP/Pix integration — settlement only happens through the manual operator endpoint; tax documents are deterministic storage paths, not rendered PDFs.

### E7 — Analytics and Reporting
- [ ] View a campaign's results dashboard at `/app/campaigns/:id/dashboard`
- [ ] Export a campaign ROI report, poll to completion
- [ ] Creator: view own performance at `/creator-portal/performance`
- [ ] Agency: generate a branded per-client report; set agency branding; compare two clients at `/app/reports/compare`
- **Known limitations:** metrics ingestion is a stub, no real social-platform calls; the cross-client comparison escape hatch covers the aggregate table but **not** `account`/`campaign`/`invoice` yet — true cross-client comparison may still partially fail even after today's fix, this is a separate, not-yet-closed gap.

### E8 — Creator Recruitment and Growth
- [ ] `aurora_operator`: create an unclaimed creator profile
- [ ] Creator: self-register at `/register` (replaces the old creator-id-only stub) or claim an invitation link
- [ ] Link a social account during onboarding (OAuth stub — won't hit a real provider)
- [ ] View the auto-generated media kit; set rate preferences
- **Known limitations:** social-auth, audience-insights, and authenticity-scoring adapters are all stubs, no real network calls; LGPD data-subject requests are ops-mediated only, no creator-facing self-service form.

### E9 — Agency Multi-Client Operations
- [ ] Switch client context via the account-switcher banner; confirm campaign pages re-scope to the selected client
- [ ] Copy a campaign template to another client
- [ ] Mint a public client-report share link; open it **unauthenticated** to confirm it actually works without login; revoke it and confirm it stops working
- [ ] View a client's audit log at `/app/audit-log` (agency_admin/agency_operator only)
- **Known limitations:** custom domain for branding only stores the value, no real DNS/cert activation.

---

## 3. What this session fixed — re-verify these specifically live

These are new as of 2026-11-02 and have no automated test against a real deployed Postgres yet — the local verification is in `project_rls_bypassrls_confirmed.md`, but the live environment hasn't been checked.

- [ ] Section 1 above (tenant isolation) passing at all *is* the primary proof.
- [ ] Register → verify → login completes without a 500 (previously broke under real RLS enforcement).
- [ ] Watch Railway's **Logs** for `BrandSafetyScheduledTasksService` — within ~2 minutes of any deploy, you should see either nothing (no stale checks) or `Expired N pending safety checks to check_unavailable` with **no** `invalid input syntax for type uuid` error.
- [ ] If you exercise E7's agency cross-client comparison or E9's template copy (the two other places with the same `SET LOCAL = $1` syntax bug, also fixed today), confirm no `syntax error at or near "$1"` in the logs.

---

## 4. Already known, not from today — don't re-report these

- Creator cannot decline a campaign opportunity (shortlist entry is always locked by the time the opportunity exists).
- No `CONFIRMED → ACTIVE` campaign state transition exists.
- Matching engine's geography/age/gender dimensions always report a match.
- No CI pipeline; no automated integration tests against a real Postgres instance.
- Logo upload (S3) and payment settlement (PSP/Pix) are both unwired stubs by design for this pilot.
- `docs/remediation/tenant-isolation-rls-and-roles-guard/summary.md` lists its own pre-existing open items (e.g. a route-sweep test for future creator-portal routes was never written).

If something breaks that **isn't** on this list and isn't in section 1-3's "known limitation" notes, that's a genuine new finding worth reporting.
