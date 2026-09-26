# ADR-0003: Role-Based Access Control with Workspace-Scoped Roles

**Status:** Proposed
**Date:** 2026-09-25
**Epic:** E1 -- Access and Onboarding
**Governs:** FR-04, FR-05, FR-58, US-04, US-45, NFR-16

## Context

Aurora needs an authorization model that satisfies three requirements:

1. **Distinct roles for different responsibilities** (FR-04): brand owner, brand manager, brand analyst, agency administrator, and agency operator, each with a defined set of permissions.
2. **Server-side enforcement on 100% of requests** (NFR-16): the frontend may hide UI elements for convenience, but the backend must independently reject unauthorized actions.
3. **Per-client scoping for agency operators** (FR-58, US-45): an operator in an agency workspace should only access the client accounts they have been assigned to, not the entire workspace.

The resolved questions for E1 explicitly say: "No detailed permissions matrix required upfront. Use standard RBAC semantics (owner invites/assigns roles, manager manages campaigns, analyst is read-only)." This means the model should be simple and predictable, not fine-grained or configurable.

Three approaches were considered:

- **Attribute-based access control (ABAC).** Evaluates policies against arbitrary attributes of the user, the resource, and the environment. Very flexible, but the flexibility is a liability for a small team: policies are harder to reason about, harder to test, and harder for a new team member to understand. Aurora's current requirements are well served by a fixed set of roles.

- **Permission-per-action (granular RBAC).** Each action is a named permission, and roles are bags of permissions stored in the database. Allows runtime configuration of roles. More flexible than needed -- the resolved questions say "standard RBAC semantics," not "configurable permissions." The indirection also makes it harder to grep the codebase and answer "who can do this?" without consulting the database.

- **Fixed roles with hardcoded permission checks.** Each role is an enum value. Permission checks are guard decorators or middleware that reference the enum directly. The mapping from role to permitted actions is visible in the code, testable with unit tests, and impossible to misconfigure at runtime.

## Decision

Aurora uses fixed, workspace-type-scoped roles with hardcoded permission checks. The implementation has three parts:

1. **Roles are an enum**, not a database-configurable entity. The enum values for E1 are: `brand_owner`, `brand_manager`, `brand_analyst`, `agency_admin`, `agency_operator`. Additional roles (such as `creator`, which belongs to E8) will extend the enum in future epics.

2. **Permission checks are NestJS guards** applied at the controller or handler level. A guard takes one or more required roles and compares them against the user's membership for the current account context. Example: `@Roles('brand_owner', 'agency_admin')` on the invitation endpoint.

3. **Agency operator client scoping** is a second layer. After the role guard passes, a separate guard checks whether the target `account_id` is in the operator's `operator_client_access` set. Agency admins bypass this check (they have implicit access to all accounts in the workspace).

All authorization denials are logged to the audit log with the acting user, the attempted action, and the target resource (NFR-16, NFR-17).

## Consequences

**What Aurora gains:**
- Simplicity. A developer can search the codebase for `@Roles('brand_owner')` and immediately see every action restricted to the owner role. No database lookup, no policy engine, no runtime configuration to get wrong.
- Testability. Each guard is a unit-testable function. The integration test suite includes an explicit test for every denial scenario in the stories (US-04 scenario 4, US-47 scenario 4).
- The model matches the mental model the stories describe: "owner invites, manager manages, analyst reads."

**What Aurora gives up:**
- Adding a new role or changing a role's permissions requires a code change and a deploy, not a database update. For a pilot with five roles, this is a feature (changes are reviewed in a pull request). If Aurora eventually needs dozens of roles or customer-configurable permissions, the model will need to evolve.
- No runtime role creation. A brand cannot invent a custom role. This matches the current requirement ("no detailed permissions matrix"), but it is worth recording as a deliberate limitation.

**Risks:**
- A forgotten `@Roles` guard on a new endpoint is an authorization bypass. Mitigation: the integration test suite includes a test that hits every registered route with an unauthorized role and expects a 403. This test breaks when a new route is added without a guard.
