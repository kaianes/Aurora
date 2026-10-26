# ADR-0021: Content Safety Judgment Isolated Behind a `ContentSafetyAdapter` Interface, Implementing the Two-Tier Cascade

**Status:** Proposed
**Date:** 2026-10-20
**Epic:** E4 -- Brand Safety
**Governs:** US-16, FR-32, NFR-03, NFR-29, NFR-34

## Context

NFR-29 requires that the brand safety model be replaceable "without disturbing the money path: replacing it should not require changes to campaign or payment code, nor a database migration." `docs/architecture.md` already commits, at the whole-platform level, to an inference adapter boundary for both matching and brand safety (section 2.1: "An inference adapter isolates matching and brand safety behind an internal port, never a provider SDK directly") and to a specific cost mechanism for brand safety: a two-tier model cascade with a cached ruleset prefix (section 3.2, QAS-02). E3 already executed the equivalent decision for matching -- `MatchingEngineAdapter`, with `RealMatchingEngineAdapter` as a swappable implementation behind a DI token `campaign` consumes and never reaches past (ADR-0011).

This ADR is E4's version of that same decision, made concrete for brand safety: where exactly does the cascade live, what is the interface other code depends on, and what, specifically, can change later without migrating anything.

Two structural options were considered for where judgment logic lives:

- **Inline in the check-processing job.** The worker that processes a `run-safety-check` job calls the model provider's SDK directly, with tiering and prompt logic embedded in the job's own code. Simpler to write initially, but it means "replacing the model" is indistinguishable from "changing the job," which is exactly the coupling NFR-29 rules out -- any future change to scoring touches the same code path that also writes `safety_check` rows, creating a much larger blast radius for review and testing than the actual behavior change warrants.
- **A dedicated adapter interface**, analogous to `MatchingEngineAdapter`, that the job calls as its only dependency for judgment. The job's responsibility shrinks to orchestration (create rows, enqueue, handle timeouts); all model-specific behavior -- which tiers exist, which model each tier calls, how the ruleset is formatted into a prompt, how a verdict is parsed back into a shape the rest of the system understands -- lives entirely inside the adapter's implementation.

## Decision

E4 defines `ContentSafetyAdapter`, exported by the `brand-safety` module and consumed by exactly one thing: the `run-safety-check` job processor (section 4 of the E4 architecture document).

```typescript
interface ContentSafetyAdapter {
  evaluate(input: {
    campaignId: string;
    effectiveRuleset: EffectiveRule[]; // resolved per ADR-0019, already merged
    channels: {
      caption: string;
      onScreenText: string | null;
      audioTranscript: string | null;
    };
  }): Promise<
    | { outcome: 'pass'; tierReached: 'tier1' | 'tier2' }
    | {
        outcome: 'flagged';
        tierReached: 'tier1' | 'tier2';
        triggers: Array<{ ruleId: string; channel: 'caption' | 'on_screen_text' | 'audio'; matchedExcerpt: string }>;
      }
  >;
}
```

`RealContentSafetyAdapter` implements the cascade `docs/architecture.md` QAS-02 already specified: a fast, cheap tier-1 screen (Claude Haiku) against every submission; escalation to a stronger tier-2 model (Claude Opus) only when tier-1's confidence is ambiguous; both tiers prompted with the campaign's effective ruleset occupying a cached, stable prefix, so the cost of the ruleset itself is paid once per campaign rather than once per check. The adapter never writes to any database table directly -- it returns a judgment, and the calling job (not the adapter) is responsible for persisting `safety_check`, `safety_rule_trigger`, and `safety_review_queue_item` rows. This keeps the adapter a pure function of its input from the rest of the system's point of view, which is what makes it safely swappable.

Media extraction (OCR for on-screen text, ASR for audio) is a **separate** adapter, `MediaExtractionAdapter`, deliberately not folded into `ContentSafetyAdapter`. Extraction is a transcription concern; safety judgment is a reasoning concern. Keeping them apart means a future change to the OCR/ASR provider never touches judgment code and vice versa, each satisfying NFR-29 independently rather than one swap risking the other's behavior.

Both adapters are bound via Nest's DI container the same way `campaign` binds `MatchingEngineAdapter` (`campaign.module.ts`'s `provide`/`useExisting` pattern): the `brand-safety` module provides `RealContentSafetyAdapter` under a `CONTENT_SAFETY_ADAPTER` token, and the `run-safety-check` processor injects the token, never the concrete class.

## Consequences

**What Aurora gains:**
- Replacing the safety model -- a new provider, a different tiering threshold, a third tier, a different prompt structure entirely -- means changing `RealContentSafetyAdapter` and its DI binding. No table in section 2 of the architecture document changes shape, and no code in `campaign` or any future payment module changes at all, because neither depends on the adapter -- they depend only on `BrandSafetyGateService`'s computed gate status (section 3.6), which is unaffected by how a verdict was produced.
- The adapter's input/output shape is deliberately generic (channels in, pass-or-flagged-with-triggers out) rather than modeling Claude-specific concepts like prompt caching or tier names in its public contract -- a provider switch away from Claude entirely is a change inside the adapter, not a change to its interface.
- NFR-34's cost mechanism (the cached ruleset prefix) lives entirely inside the adapter, which means tuning it -- a different cache strategy, a different escalation threshold -- is a cost optimization that never risks regressing the gate's correctness, since the gate only ever sees `pass` or `flagged`, never the cost details.

**What Aurora gives up:**
- An extra layer of indirection between the job and the model call, which is the same cost E3's matching adapter already pays and `docs/architecture.md` Table 7 (N-02) already names as an accepted non-risk: "Satisfies NFR-29 cheaply; cost is one indirection."
- The adapter interface itself becomes a stability commitment -- changing its *shape* (not its implementation) would ripple into the job processor, which is the one piece of code allowed to depend on it. This is managed the same way E3 manages `MatchingEngineAdapter`'s stability: the interface grows by adding methods (as E3 did, adding `generateShortlist` alongside the unchanged `estimatePool`), not by changing existing method signatures.

**Risk:** The escalation rate this cascade's cost claims depend on is unmeasured before launch, exactly as `docs/architecture.md` risk R-01 already states for the platform-wide version of this decision. This ADR inherits that risk rather than introducing a new one; the mitigation (a labeled evaluation set, production instrumentation of the escalation rate) is already committed to at the platform level and applies unchanged here.
