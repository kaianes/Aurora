# ADR-0002: Tenant Isolation with PostgreSQL Row-Level Security

**Status:** Proposed
**Date:** 2026-09-25
**Epic:** E1 -- Access and Onboarding (formalizes a decision from `docs/architecture.md`, QAS-03)
**Governs:** FR-07, NFR-16, US-47

## Context

Aurora is multi-tenant in two ways. Brand workspaces isolate one brand's data from another. Agency workspaces isolate multiple client accounts within the same workspace, where those clients may be competing brands (FR-07). NFR-16 requires zero successful cross-tenant reads and every denied attempt logged. This is a promise-holds requirement: it does not relax for pilot scale.

The architecture document (section 3.2, QAS-03) already decided on shared-schema multi-tenancy with PostgreSQL row-level security (RLS). This ADR formalizes that decision, specifies its implementation for E1, and records the alternatives that were rejected.

Three isolation models were considered:

- **Database per tenant.** Structurally impossible to read across tenants, which is the strongest guarantee. However, NFR-09 allows up to 10 client accounts per agency workspace, and each agency workspace would need 10+ databases. At pilot scale with even a few agencies, the fixed cost of managing dozens of databases contradicts NFR-33 (infrastructure cost ceiling). Connection pooling, migrations, and backups all multiply by tenant count.

- **Schema per tenant.** Similar isolation properties to separate databases, with lower overhead. Still multiplies migration complexity and makes connection-pool management nontrivial. The PostgreSQL ecosystem supports it, but tooling (especially ORM schema management) is less mature for this pattern than for shared-schema.

- **Shared schema with row-level security.** All tenants share tables, with an `account_id` column on every tenant-scoped row. PostgreSQL RLS policies filter rows based on a session variable (`app.current_account_id`) set at connection checkout. The database enforces isolation, not the application. A query that forgets to filter by account still returns only the correct tenant's data.

## Decision

All tenant-scoped tables use a shared schema with RLS policies keyed on `account_id`. The implementation has four parts:

1. **Every tenant-scoped table** carries an `account_id` column (NOT NULL, foreign key to `account.id`) and has RLS enabled with `FORCE ROW LEVEL SECURITY`, using a policy of the form:
   ```sql
   CREATE POLICY tenant_isolation ON <table>
     USING (account_id = current_setting('app.current_account_id')::uuid);
   ```

2. **The repository layer** sets `app.current_account_id` on every database connection at checkout, before any query runs. A connection without this setting returns zero rows from any tenant-scoped table. This is the single chokepoint through which all tenant context flows.

3. **A CI check** (risk R-02 from the architecture document) enumerates every table with an `account_id` column and fails the build if any lacks an RLS policy. This turns a forgotten policy from a silent vulnerability into a build failure.

4. **Agency operator scoping** is handled at the application layer, not RLS. RLS operates on a single `account_id` value per connection, but an `agency_admin` needs to query across all client accounts in their workspace (for listing, for example). The middleware checks the user's role: for `agency_admin`, it sets the account context per-query based on the target account; for `agency_operator`, it first verifies the target account is in the user's `operator_client_access` set before setting the context.

## Consequences

**What Aurora gains:**
- Isolation enforced by the database, not by developers remembering to add a WHERE clause. A new developer who writes a query without an account filter gets zero rows, not another tenant's data.
- One schema, one migration path, one connection pool. Fixed cost does not scale with tenant count.
- The CI check makes the failure mode (a missing policy) detectable before merge.

**What Aurora gives up:**
- RLS adds a small overhead to every query (the policy is evaluated per row). At pilot scale this is negligible. At very large scale, it could become measurable, but the alternative (per-tenant databases) would have a much higher fixed cost.
- Listing across accounts (agency admin listing all clients) requires careful connection-context management. The middleware handles this, but it is a subtlety that new developers must understand.
- A single compromised database exposes all tenants' data. Mitigation: encryption at rest (NFR-14), least-privilege database credentials, and the application never uses a superuser role that bypasses RLS.

**Risks:**
- R-02 (from the architecture document): a table created without an RLS policy is a cross-tenant breach with no second line of defense. The CI check is the mitigation, and it must be maintained as tables are added in future epics.
