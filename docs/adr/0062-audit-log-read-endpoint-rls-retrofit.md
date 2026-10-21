# ADR-0062: Audit Log Read Endpoint -- Retrofitting an Asymmetric Read/Write RLS Policy Rather Than Trusting the Service Layer Alone, Scoped to Agency Workspaces by Role

**Status:** Proposed
**Date:** 2026-10-21
**Epic:** E9 -- Agency Multi-Client Operations
**Governs:** FR-60 (shared US-38/US-45 addendum), NFR-16, NFR-17

## Context

FR-60 requires "an audit log of actions taken within each client account, attributable to the acting user." The stories document, checking the codebase directly, confirmed the write half has been fully built and in continuous use since E1: `AuditService.log` is called by `client_account.created`, `operator_access.granted`, `operator_access.revoked`, `authorization.denied`, and every subsequent epic's own events. It also confirmed, just as directly, that no read path has ever existed: "there is no `audit.controller.ts` anywhere in the codebase, and no epic's frontend route map names a screen for viewing it." Closing this gap is this epic's job.

Before designing the endpoint, the actual table was checked against the actual RLS convention every other tenant-scoped table in this platform follows (E1 section 2.5's own CI-enforced rule: "every table with an `account_id` column has an RLS policy"). `audit_log` carries `target_account_id` and has **no RLS policy at all** -- not an oversight discovered late, but a consequence of the fact that nothing has ever read this table except its own write path, which has no reason to filter by tenant since it is only ever writing one row at a time, already scoped correctly by the calling code. The moment this epic adds the first read endpoint, that absence stops being harmless: a read endpoint with no database-level tenant boundary beneath it, relying entirely on its own service-layer `WHERE` clause to never have a bug, is precisely the posture NFR-16 ("100% of requests authorized server-side; zero successful cross-tenant reads") exists to make unnecessary to trust.

The naive fix -- apply the same symmetric policy every other tenant-scoped table uses, `target_account_id = current_setting('app.current_account_id')`, to every command -- was checked against the actual write call sites rather than assumed safe, and found to break three of them:

- `AgencyService.createClient` writes `client_account.created` with `targetAccountId` set to the **brand-new client account**, while the request's own session runs under the agency's **home** account (`POST /agency/clients` is called in that context, not the new account's, which does not exist until this very call creates it).
- `grantOperatorAccess`/`revokeOperatorAccess` write their events with `targetAccountId` set to the **client** account, while the caller may be acting under the home account.
- `POST /auth/register` writes `user.registered` from a public endpoint, before any `X-Account-Id` or account context exists at all -- `current_setting('app.current_account_id', true)` returns `NULL` in that case, and `NULL = <anything>` is never true in SQL, so a naive symmetric policy would silently reject this insert outright, breaking account registration itself.

A second, narrower alternative -- leave `audit_log` without RLS and rely solely on the new endpoint's own service-layer filter -- was rejected for the reason stated above: it is exactly the single point of failure NFR-16's own target language ("zero successful cross-tenant reads... under all conditions") is written to not have to tolerate for a table this platform explicitly calls its accountability record.

## Decision

**Enable RLS on `audit_log` for the first time, with two separate, asymmetric policies rather than one symmetric one:**

- `FOR INSERT WITH CHECK (true)` -- writes remain unrestricted, because audit logging is, by design, a cross-cutting capability invoked from request contexts that legitimately target an account other than the caller's own current session, or no account at all. This is not a weakening of the table's protection; it reflects what the write path has always actually needed to do, verified against the specific call sites above, not merely asserted.
- `FOR SELECT USING (target_account_id = current_setting('app.current_account_id', true)::uuid)` -- the actual, enforced tenant boundary for the one capability this epic adds. A row with a `NULL` `target_account_id` (a hypothetical future platform-level event with no single tenant owner) is never returned to any single-tenant read, consistent with FR-60's own framing as a *per-client* audit trail, not a platform-wide one.

**The new `GET /audit-log` endpoint is restricted by role to `agency_admin` and `agency_operator`.** This was chosen over leaving the endpoint open to any authenticated account member (which would have technically worked, since `RolesGuard` already refuses any caller without a resolvable relationship to the target account) for two reasons: first, the stories document's own open question 5 explicitly scopes FR-60's read surface to agency client accounts, traced only to US-38 and US-45, and states plainly that a brand-workspace equivalent "is not addressed by this document... recorded here as a scope boundary this document deliberately holds to, not an oversight" -- this decision follows that same discipline rather than silently widening scope because the underlying query happens to generalize. Second, the role restriction is free: brand-workspace users never hold either role (E1 section 2.3), so no workspace-type check is needed anywhere in the implementation -- the restriction and the scope boundary are the same mechanism.

No new authorization *logic* is written beyond the role decorator: the account-level check (which client account's log a given caller may see, and the operator-vs-admin distinction within that) is entirely the existing `RolesGuard`/`AccountAccessService.resolveAccess` pipeline, unchanged, doing exactly what it already does for every other account-scoped `GET` in this platform.

## Consequences

**What Aurora gains:**
- FR-60 is closed completely: the write path (unchanged, verified not to regress) and a new read path enforced at two layers (service-layer query shape and database-layer RLS), not one. This is a stronger guarantee than the read endpoint would have had if built against the table as it stood, and it costs nothing in new application code beyond the controller and one new `AuditService` read method, since the account-boundary enforcement is the database's job now, not a line of code a future refactor could accidentally remove.
- The three existing write call sites that would have broken under a naive symmetric policy were identified and checked *before* writing the policy, not discovered by an incident after deployment -- this ADR exists specifically so that fact is on the record, and so a future reviewer changing this policy again has the same list of call sites to re-check against.
- US-38-addendum scenario 2 (an operator denied Client B's log, with the denial itself logged) is satisfied entirely by machinery that already existed and was already exercised by every other epic's agency-scoped endpoint -- there was no new denial-logging code to write or test from scratch.

**What Aurora gives up:**
- `audit_log` writes remain, by design, unchecked against any tenant boundary at the database level. This is a deliberate, bounded risk (a bug in a *future* write call site could write an audit entry under the wrong `target_account_id` without the database objecting) rather than a closed one; the mitigation is that `AuditService.log`'s call sites are few, already reviewed, and any new one added by a future epic is exactly the kind of change this platform's own review process already catches, the same trust level every prior epic's write paths have operated under since E1.
- The read endpoint is agency-only for this release. A brand-direct workspace (Marina's) has no equivalent screen for her own account's audit trail, which may be a real gap if product later decides accountability matters there too -- recorded as a deliberately *not*-closed question, matching the stories document's own stated posture, rather than an oversight to rediscover later.
- `ip_address` and `user_agent` are retained in the table (for direct, out-of-band security investigation) but never surfaced on this business-facing read screen. An investigator who genuinely needs that detail must go to the database directly; this is judged an acceptable, minimization-leaning tradeoff rather than a limitation that blocks any stated acceptance criterion.
