# ADR-0049: OAuth Tokens Stored With Application-Level Envelope Encryption, Rotated by a Proactive Refresh Job

**Status:** Proposed
**Date:** 2026-10-21
**Epic:** E8 -- Creator Recruitment and Growth
**Governs:** US-24.1, FR-08, NFR-15

## Context

NFR-15 requires "zero credentials stored. Authorization tokens only, encrypted at rest and rotated at least every 90 days." `docs/architecture.md` section 4.2 already commits, at the whole-platform level, to "envelope encryption for tokens and payout credentials" as the control satisfying NFR-14/NFR-15 together, and section 4.1's STRIDE analysis names "stolen OAuth tokens used against a creator's account" as a spoofing/elevation threat whose mitigation is explicitly "tokens encrypted at rest, rotated >= every 90 days, minimally scoped." Until this epic, no code in the codebase actually implements that envelope encryption -- the closest precedent, `user.mfa_secret`, is described in the E1 architecture document as "encrypted at rest with an application-level key (envelope encryption)" but the current `AuthService` implementation stores it as a plain column value, relying on infrastructure-level (disk/volume) encryption alone to satisfy the generic AES-256-at-rest commitment in NFR-14. This epic is the first to actually need the stronger, field-level guarantee NFR-15 states explicitly and separately from NFR-14 -- a distinction the PRD itself draws by giving OAuth tokens their own NFR rather than folding them into the general encryption-at-rest requirement.

Two questions needed answering together:

1. **Where does the encryption happen?** Relying on infrastructure-level (PostgreSQL volume/backup) encryption alone would satisfy NFR-14's literal wording but not the stronger, field-specific intent of NFR-15 and the architecture document's own stated control ("envelope encryption for tokens") -- a database administrator or a backup file leak would expose the raw token under infra-only encryption, whereas envelope encryption keeps the token unreadable without a separate application-held key even if the database itself is exfiltrated.
2. **What satisfies "rotated at least every 90 days"?** A token's *value* can be rotated by re-encrypting the same bytes (meaningless -- rotation has to mean the underlying credential itself changes) or by actually fetching a new access/refresh token pair from the platform. Only the second is a real rotation; the first would be rotation theater.

Two structural options were considered for where encryption happens:

- **Database-level transparent encryption only** (rely on the managed PostgreSQL provider's at-rest encryption, satisfying NFR-14 generically). Rejected as insufficient for NFR-15 specifically: the architecture document already commits to envelope encryption as a named control for this exact data category, and a credential that unlocks a creator's real social media account is a materially higher-stakes secret than most other columns in this schema (the STRIDE table singles it out for its own threat row).
- **Application-level envelope encryption**: encrypt the token value with AES-256-GCM using an application-held master key (injected via config at deploy time, per NFR-30, never hardcoded), store ciphertext plus a per-record nonce and a key-version marker, so the plaintext token is never written to the database at all.

## Decision

`creator_social_account.access_token_ciphertext`/`refresh_token_ciphertext` hold AES-256-GCM ciphertext only. A new, narrow service, `TokenCipherService` (exported by `creator-network`, used by nothing outside the OAuth linking/refresh code path), performs:

```typescript
interface TokenCipherService {
  encrypt(plaintext: string): { ciphertext: string; nonce: string; keyVersion: number };
  decrypt(input: { ciphertext: string; nonce: string; keyVersion: number }): string;
}
```

The master key is supplied via externalized configuration (`TOKEN_ENCRYPTION_KEY`, an environment-injected secret per the platform's existing NFR-30 convention, the same mechanism `JWT_SECRET` already uses), never checked into source or baked into an image. `token_key_version` is stored per record specifically so a future master-key rotation can re-encrypt records lazily (on next write) rather than requiring a synchronous, all-at-once re-encryption migration -- the version column is what makes key rotation itself an additive, non-blocking operation rather than a one-time cutover.

**Rotation of the token's own value** (the literal requirement, distinct from key rotation) is satisfied by the `refresh-social-tokens` daily cron job (E8 architecture doc section 9): any `creator_social_account` with `token_expires_at` within 7 days of now has its token proactively refreshed via `SocialAuthAdapter.refreshToken`, well before the platform's own expiry and far more frequently than the 90-day ceiling NFR-15 sets as a maximum, not a target. A creator whose token is never refreshed because she never re-authorizes within 90 days is the one case this job cannot force -- but that case is covered by a different, already-existing mechanism: `refreshToken` returning `revoked` (or the platform's own token simply no longer accepting refresh past its own, platform-defined maximum lifetime) sets `status = disconnected`, which removes the token from active use entirely rather than leaving a stale credential sitting unrotated indefinitely.

## Consequences

**What Aurora gains:**
- NFR-15's "encrypted at rest" is satisfied by a mechanism independent of infrastructure configuration -- a misconfigured disk-encryption setting or a raw database/backup leak does not expose a usable token, only ciphertext requiring the separately-held application key.
- The "rotated at least every 90 days" requirement is satisfied with wide margin, as a structural property of a daily job rather than a once-per-quarter manual or scheduled task someone has to remember to run.
- `token_key_version` makes a future real master-key rotation (e.g., after a suspected key exposure) an operational, lazy-migration task rather than an emergency synchronous one, consistent with NFR-30's "secrets... rotated on schedule and on suspected exposure."

**What Aurora gives up:**
- This epic introduces the platform's first real field-level cryptography code (`TokenCipherService`), which is new surface area to get right and to test, in contrast to every prior epic's reliance on infrastructure-level encryption alone. This is accepted because NFR-15 (unlike NFR-14) explicitly names this exact data category and the architecture document already promised this exact mechanism.
- Key management itself (where `TOKEN_ENCRYPTION_KEY` lives, who can read it, how it is rotated in practice) is an operational responsibility this ADR creates but does not fully specify -- consistent with how ADR-0038 left `aurora_operator`'s grant policy to a future decision, this ADR builds the mechanism a future key-management policy would attach to, not the policy itself.

**Risk:** A master key held only in environment configuration, with no dedicated secrets-management/KMS service in this pilot's stack (`docs/architecture.md` section 2.5 names no such service), means key compromise is possible if the deployment environment itself is compromised -- the same exposure surface every other environment-injected secret in this codebase already has (`JWT_SECRET`, `JWT_REFRESH_SECRET`). Mitigation: this is an accepted, explicitly-flagged pilot-scale limitation, not a hidden one; a real KMS-backed envelope key (e.g., a managed cloud KMS wrapping the data key) is the natural upgrade path once the team operates at a scale where that additional infrastructure is justified, and `token_key_version` is specifically designed so that upgrade requires no schema change.
