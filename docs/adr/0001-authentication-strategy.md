# ADR-0001: Authentication Strategy

**Status:** Proposed
**Date:** 2026-09-25
**Epic:** E1 -- Access and Onboarding
**Governs:** US-01, US-04, NFR-19

## Context

Aurora needs an authentication system that satisfies three constraints simultaneously:

1. **Registration must be fast and frictionless** (US-01). Marina and Renata should go from the sign-up page to an active workspace in minutes, with no sales call and no heavy verification upfront. The resolved questions explicitly state that MFA must not be required at registration.

2. **Financial-privilege roles must carry stronger authentication** (NFR-19). Once a user can approve payouts or change bank details, a stolen password alone must not be sufficient.

3. **The system must not reveal whether an email is registered** (US-01, scenario 2). Enumeration protection is a baseline expectation for any system handling business accounts.

The team considered three approaches:

- **Third-party identity provider (Auth0, Clerk, Supabase Auth).** Fastest to ship, but introduces a runtime dependency on a vendor for every login and every authorization check. At pilot scale this is fine, but the pricing model scales per monthly active user, and Aurora's creator base will grow faster than its revenue. The team also loses direct control over the email verification flow and the MFA enforcement rules, which are product-level decisions rather than infrastructure ones.

- **OAuth-only (sign in with Google/Microsoft).** Eliminates password management entirely. However, many Brazilian SMB users do not have Google Workspace or Microsoft 365 accounts tied to their company domain, and requiring a social login excludes the exact mid-market audience Aurora targets.

- **Email and password with TOTP MFA, built on proven libraries.** More code to own, but the authentication behavior is directly under the team's control. bcrypt for hashing, TOTP (RFC 6238) for MFA, and short-lived JWTs for session management are all well-understood, well-supported, and carry no per-user vendor cost.

## Decision

Aurora uses email-and-password authentication with the following design:

- **Passwords** are hashed with bcrypt, work factor 12. New registrations are checked against a breached-password list (the k-anonymity API from Have I Been Pwned or an equivalent offline list).
- **Email verification** is required before a user can log in. Verification tokens are 32-byte cryptographically random values with a 24-hour expiry. The verification endpoint also issues a session so the user does not need to log in separately after verifying.
- **Sessions** use short-lived JWTs (15-minute access token, 7-day refresh token with rotation on use). The access token carries the user's memberships (account IDs and roles) so authorization checks do not require a database round-trip on every request.
- **MFA** uses TOTP (RFC 6238), available to all users and mandatory when a user is assigned a role with financial privileges. At E1 scope, no roles carry financial privileges, so MFA is opt-in. The enforcement hook is built into the role-assignment endpoint from the start so it is not forgotten when E6 (Payments) adds roles that trigger it.
- **Enumeration protection**: registration and password-reset endpoints always return a generic success message, regardless of whether the email exists.

The team does not build a custom authentication library. It uses NestJS Passport with the local strategy for email/password, and a well-maintained TOTP library (such as otplib) for MFA.

## Consequences

**What Aurora gains:**
- No per-user vendor cost. Authentication cost is zero marginal at any creator-base size.
- Full control over the verification, MFA enforcement, and enumeration-protection behaviors, which are product decisions, not infrastructure ones.
- The MFA enforcement hook is in place from E1, so E6 does not need to retrofit it.

**What Aurora gives up:**
- The team owns password hashing, token lifecycle, and MFA verification code. This is well-trodden ground, but it is still code to maintain and get right.
- No SSO or social login at launch. This can be added later (the user table has no dependency on the password column being non-null), but it is not available on day one.

**Risks:**
- A bug in the authentication flow is a security incident, not a feature regression. Mitigation: the integration test suite includes explicit tests for enumeration protection, token expiry, and MFA enforcement. These run on every build (NFR-28, architecture section 5.2).
