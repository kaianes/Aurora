# ADR-0033: Payout Execution Isolated Behind a `PayoutExecutionAdapter`, With Only a Stub/Manual Implementation in This Pilot

**Status:** Proposed
**Date:** 2026-10-21
**Epic:** E6 -- Payments and Financial Transparency
**Governs:** US-35b, US-35c, FR-45, FR-46, NFR-11, NFR-36

## Context

FR-45 requires Aurora to "execute each payout within the window committed to the creator." NFR-36 requires that "payout logic depends on an internal abstraction, so a payment provider can be replaced without changes to FR-44 through FR-47 behavior." `docs/architecture.md` already commits, at the whole-platform level, to this exact pattern for both matching and brand safety (section 2.1: "An inference adapter isolates matching and brand safety behind an internal port, never a provider SDK directly") and separately names a Brazilian PSP supporting Pix as the intended real-world payment provider (section 2.5, Table 3). E3 and E4 already executed the equivalent decision twice -- `MatchingEngineAdapter` (ADR-0011) and `ContentSafetyAdapter` (ADR-0021) -- each with a swappable implementation behind a DI token the consuming module never reaches past.

Unlike those two, a payout adapter's real implementation moves actual money out of Aurora's control and into a creator's bank account or Pix key. This is qualitatively different from a matching score or a safety verdict: a wrong matching result is a quality regression; a wrong payout instruction is a financial incident, potentially an irreversible one. The task producing this epic's architecture is explicit that this pilot must not call or require a real payment processor's live or production API at all -- actual money movement is declared out of scope for this release, with the adapter boundary existing precisely so that scope decision can be reversed later without disturbing anything else.

Two structural options were considered for where this boundary sits:

- **Build the real integration now, gated behind a feature flag.** This would exercise the real code path end to end, but it means a credential, a sandbox account, and a live (even if sandboxed) network dependency on a third-party financial system exist in the pilot's dependency graph before the product has validated anything about creator payment beyond "can we track what is owed." It also means the first real external dependency this epic introduces is the one category of integration a small team can least afford to get wrong under time pressure.
- **Define the adapter interface now, ship only a stub plus an explicit manual fallback, and build a real implementation later as a separate, independently-timed piece of work.** This defers the hardest, highest-stakes integration until the rest of the money path (the obligation model, the ledger, the notification and escalation mechanics) has been built and exercised against something predictable.

## Decision

E6 defines `PayoutExecutionAdapter`, exported by the new `payments` module and consumed by exactly two things: `attempt-payout-execution`/`poll-in-flight-payouts` (the scheduled jobs, section 5 of the E6 architecture document) and nothing else -- no controller, no other module, calls it directly.

```typescript
interface PayoutExecutionAdapter {
  executeTransfer(input: {
    payoutObligationId: string;
    creatorId: string;
    amount: string; // payout_net, BRL
    idempotencyKey: string; // = payoutObligationId, per docs/architecture.md S-02
  }): Promise<
    | { outcome: 'instructed'; providerReference: string | null }
    | { outcome: 'failed'; reason: string }
  >;

  checkStatus(input: { providerReference: string | null; payoutObligationId: string }): Promise<
    | { outcome: 'settled' }
    | { outcome: 'failed'; reason: string }
    | { outcome: 'pending' }
  >;
}
```

**This pilot ships exactly one implementation: `StubPayoutExecutionAdapter`.** It makes no network call to any payment processor, sandbox or otherwise. `executeTransfer` always returns `{ outcome: 'instructed', providerReference: null }` -- it records that an attempt was made, nothing more. `checkStatus` always returns `{ outcome: 'pending' }` -- the stub never, on its own, decides that money moved. The only way a `payout_obligation` reaches `settled` in this pilot is through the explicit, MFA-gated manual endpoints (`POST /ops/payout-obligations/:id/mark-settled`, section 4.5 of the E6 architecture document), which bypass the adapter's `checkStatus` entirely and write the ledger entry and status transition directly. This is the literal, buildable form of NFR-11's own allowance for "whether the transfer runs automatically or an operator triggers it by hand" -- for this release, it is always the second branch, made honest and explicit rather than simulated by an adapter that silently auto-succeeds.

A `StripeConnectPayoutAdapter` or a direct Brazilian-PSP-Pix adapter is explicitly **not** built by this epic. When one is built, it implements the same interface, is bound to the same `PAYOUT_EXECUTION_ADAPTER` token `payments.module.ts` already defines, and `checkStatus` starts returning real outcomes -- no change to `payout_obligation`, `ledger_entry`, any controller, or any other module's code is required, which is NFR-36 stated as structure rather than intent.

**Consequence for creator banking/Pix details.** Because no real transfer is ever instructed, this pilot does not capture, store, or validate any creator banking or Pix-key information at all -- there is nothing for such data to be used for yet. NFR-19's "mandatory MFA for roles that... change bank details" therefore has no surface to gate in this release; a future real-adapter implementation is also the point at which a bank-detail capture and change flow (and the MFA gate around it) must be added, not before.

## Consequences

**What Aurora gains:**
- Zero risk of accidentally moving real money during the pilot, zero third-party financial credentials in the deployment's dependency graph, and zero live-API behavior to reason about during a security review of this epic -- the task's explicit scope boundary ("nothing in this design calls or requires a real payment processor's live or production API") is a property of the code, not a promise about how it will be used.
- The rest of this epic's hard problems -- idempotent obligation creation, the append-only double-entry ledger, the 24-hour failure-notification clock, the escalation flag -- are built and exercisable against a predictable, fully-controlled stub, rather than against the added variable of a real provider's sandbox latency, rate limits, or error taxonomy.
- The swap to a real provider is isolated to one new class and one DI binding, exactly mirroring E3's `RealMatchingEngineAdapter` and E4's `RealContentSafetyAdapter` precedents -- a well-rehearsed pattern in this codebase, not a novel risk.

**What Aurora gives up:**
- NFR-11's "≥ 95% of payout obligations settled by the committed deadline" cannot be demonstrated automatically in this pilot -- every settlement requires a human (the `aurora_operator`) to act within the window, which does not scale past a pilot's obligation volume and is explicitly a stand-in for automation the team cannot yet build, exactly the framing `docs/architecture.md`'s own NFR catalog already uses for pilot-scale targets with a manual fallback.
- A real demo of "Aurora pays creators in seconds via Pix" is not possible with this adapter alone; any such demonstration would need to either build the real adapter first or clearly stage a manual settlement as the visible step, which this design makes honest rather than hidden.

**Risk:** The entire manual-fallback path depends on an `aurora_operator` actually acting within the committed window for every obligation, for as long as this pilot runs without a real adapter -- this is a genuine operational load on whoever holds that flag, unmeasured before launch, in the same risk category `docs/architecture.md`'s R-01 and R-03 already name for provider-dependent reliability. Mitigation: the escalation sweeper (`escalate-stalled-payouts`, 24 hours before deadline) and the daily reconciliation job both surface this load as a monitored signal rather than a silent assumption, consistent with R-03's own mitigation framing ("obligations stay visibly outstanding through failure").
