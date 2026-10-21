# ADR-0037: Ledger Entries Written Only as Balanced Debit/Credit Pairs by a Single `LedgerService`

**Status:** Proposed
**Date:** 2026-10-21
**Epic:** E6 -- Payments and Financial Transparency
**Governs:** US-35a, US-35b, US-36a, FR-44, FR-45, FR-47, NFR-13

## Context

NFR-13 is this platform's one zero-tolerance target: "No financial obligation may ever be lost, duplicated, or silently altered... The payment ledger must be append-only and fully reconcilable against campaign records at any point in time." `docs/architecture.md` already names the entity (`LEDGER_ENTRY`) and the two properties it must have ("append-only and double-entry... nothing is updated or deleted, a correction is a compensating entry") at the whole-platform level, before this epic existed to build it. What `docs/architecture.md` does not specify -- because no prior epic needed a ledger to exist yet -- is the concrete schema and, more importantly, the concrete mechanism that keeps "double-entry" true in practice rather than merely in the column names.

A naive approach would let any service insert `ledger_entry` rows freely, trusting each call site to remember to write a balanced pair. This fails the same way every "convention, not mechanism" approach has already been rejected elsewhere in this codebase (e.g., E3's `below_guaranteed_minimum` being computed, never cached, specifically so it "can never drift out of sync... the way a cached boolean could"; E1's RLS being enforced at the database layer specifically because "a forgotten application-level filter yields an empty result, not another tenant's data"). A missing or mismatched second leg would not be caught by any `CHECK` constraint Postgres can express declaratively per-row, since balance is a property of a *set* of rows sharing a `transaction_id`, not of any single row in isolation.

## Decision

Exactly one service, `LedgerService`, may write to `ledger_entry`. Its only write method is:

```typescript
interface LedgerService {
  recordBalancedEntry(input: {
    transactionId: string; // caller-generated, groups the pair
    campaignId: string;
    referenceType: 'payout_obligation' | 'invoice';
    referenceId: string;
    amount: string; // BRL, positive
    debitDescription: string;
    creditDescription: string;
  }): Promise<void>; // writes both legs, in one DB transaction, or neither
}
```

`recordBalancedEntry` always writes exactly two rows -- one `direction: debit`, one `direction: credit`, both carrying the same `transactionId`, `campaignId`, `referenceType`, `referenceId`, and `amount` -- inside a single database transaction, so a crash can never leave one leg written without the other. No other method on `LedgerService` writes to the table; there is no generic "insert a row" method exposed at all. Every other service in this epic (`PayoutObligationService` on settlement, a future invoice-collection flow) calls `recordBalancedEntry`, never the `ledger_entry` repository directly -- the same "ledger boundary... only the payments module writes financial tables" discipline `docs/architecture.md` section 2.3 already names at the platform level, narrowed here to one method within that one module.

A correction is never an `UPDATE` (blocked by the append-only trigger, section 3.6 of the E6 architecture document) -- it is a second call to `recordBalancedEntry` with a new `transactionId`, reversing the original pair's direction. The scheduled `reconcile-ledger-to-obligations` job (section 5 of the E6 architecture document) is the independent check that the invariant actually held in practice: it sums debit-leg amounts per campaign and compares them to the sum of `settled` obligations' `payout_net`, paging immediately on any mismatch, rather than trusting the single-writer discipline alone.

## Consequences

**What Aurora gains:**
- "Double-entry" is a property every row in the table actually has, not a naming convention three different call sites have to independently honor correctly -- the same mechanical-rather-than-aspirational guarantee `docs/architecture.md` already promises for this entity, now actually built.
- A future financial event this epic did not anticipate (a dispute credit, a correction, a different kind of fee) has exactly one new thing to learn: call `recordBalancedEntry` with the right `referenceType`/`referenceId`. It cannot accidentally write an unbalanced ledger, because there is no code path that lets it.
- The reconciliation job's check is simple and fast (`SUM(amount) WHERE direction = 'debit' AND campaign_id = X`, compared to a known total) precisely because the schema already guarantees pairing -- the job is verifying the single-writer discipline held, not doing the balancing work itself.

**What Aurora gives up:**
- Every financial event in this epic must be known and modeled as a call to `recordBalancedEntry` ahead of time; there is no generic escape hatch for "just write a row" if a future requirement does not fit the debit/credit framing cleanly. This is treated as a feature, not a limitation, given NFR-13's zero-tolerance framing, but it does mean a future epic extending the ledger (e.g., a brand-side collection/receivables flow) must go through this same narrow interface rather than inventing its own.
- `LedgerService` becomes a stability commitment the same way `MatchingEngineAdapter` and `ContentSafetyAdapter`'s interfaces already are for their respective modules (ADR-0021's own framing) -- changing its method signature, not just its implementation, ripples into every caller.

**Risk:** The single-writer discipline is an application-layer convention (TypeScript visibility and module boundaries, enforced by the same CI architecture check `docs/architecture.md` section 5.2 already runs for "no module imports another's internals"), not a database-level guarantee -- a raw migration or an emergency hotfix that bypasses `LedgerService` could still write an unbalanced row. Mitigation: the daily reconciliation job is the independent, database-level check that catches exactly this failure mode, consistent with `docs/architecture.md`'s own framing that row-level security is "the tenancy control; the application layer is the convenience layer" -- the same two-layers-of-defense structure, applied here to financial integrity instead of tenant isolation.
