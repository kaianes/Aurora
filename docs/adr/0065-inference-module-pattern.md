# ADR-0065: Claude API Client Wrapped in a Dedicated InferenceModule

**Status:** Proposed
**Date:** 2026-11-16
**Epic:** E10 -- AI Creator Demo
**Governs:** NFR-29, NFR-30, NFR-32
**Related:** ADR-0021 (ContentSafetyAdapter pattern), ADR-0011 (MatchingEngineAdapter pattern)

## Context

E10 adds three Claude API call sites across three separate modules: `matching` (fit reasoning in `RealMatchingEngineAdapter`), `brand-safety` (tier-2 semantic check in `RealContentSafetyAdapter`), and `content-workflow` (briefing Q&A streaming). All three need to call the same external service (`@anthropic-ai/sdk`), with the same authentication credential (`ANTHROPIC_API_KEY`), and must all carry the request's correlation ID in their log entries (NFR-32).

The question is how to distribute the Anthropic SDK client across these three modules without coupling them through shared state or duplicating credential management.

Three options were considered.

**Option A -- Each module imports and instantiates the SDK client directly.**

Each calling module (`matching`, `brand-safety`, `content-workflow`) installs the SDK, reads `ANTHROPIC_API_KEY`, and creates its own `Anthropic` client instance. No cross-module coupling.

Rejected because:
1. `ANTHROPIC_API_KEY` is read in three separate places. If the credential changes format or the lookup logic needs to change (e.g., rotating keys, switching to environment-scoped secrets), it must change in three files. NFR-30 says externalized configuration; NFR-32 says logs carry a correlation ID. Meeting both across three independent clients requires repeating the same log-and-credential logic in each.
2. The SDK client is a stateful HTTP client that manages connection pooling. Three singleton instances mean three separate connection pools to the same external endpoint, which is wasteful and makes rate-limit behavior harder to reason about.
3. When a future model change is needed (a different Claude variant, or a different provider entirely), the change must be located and made in three files rather than one.

**Option B -- The existing adapter interfaces are extended to accept an injected SDK client.**

`ContentSafetyAdapter.evaluate()` and `MatchingEngineAdapter.generateShortlist()` are modified to accept the SDK client as a constructor dependency. The content-workflow module also injects the client.

Rejected because:
1. These adapter interfaces are owned by `brand-safety` and `campaign` respectively, and their design principle (ADR-0021, ADR-0011) is that the calling code depends only on the adapter interface, never on how the adapter is implemented. Adding an SDK-specific constructor parameter to either interface leaks the implementation detail into the interface contract.
2. The `MatchingEngineAdapter` interface is owned by the `campaign` module; adding an inference-specific parameter to it couples `campaign` to an inference concern it should not need to know about.

**Option C (chosen) -- A new `@Global()` NestJS module, `InferenceModule`, provides a single `InferenceService` that wraps the SDK client.**

`InferenceModule` is a new module at `backend/src/inference/`. It is registered as `@Global()` so any module in the application can inject `InferenceService` without explicitly importing `InferenceModule`. The module creates one Anthropic SDK client instance at bootstrap, reads `ANTHROPIC_API_KEY` via `ConfigService`, and exposes two methods (`completeText` and `streamText`) that each accept a `correlationId` parameter (NFR-32).

This follows the exact precedent set by ADR-0021 (the content safety adapter) and ADR-0051 (the OAuth adapter): "wrap the variable thing behind our own interface." The difference here is that `InferenceService` is not an adapter interface with multiple implementations; it is a concrete infrastructure wrapper, similar to how the platform already wraps Resend (email), Bull (queues), and S3 (object storage) behind their own service classes rather than exposing the third-party API directly.

## Decision

**Create `backend/src/inference/inference.module.ts` as a `@Global()` NestJS module that provides one `InferenceService` instance for the entire application. No other module in the codebase may import or instantiate `@anthropic-ai/sdk` directly.**

The `InferenceModule` is added to `AppModule`'s `imports` array alongside the existing global infrastructure modules (`TypeOrmModule`, `BullModule`, etc.).

`InferenceService` is not an interface with swappable implementations. It is a concrete class. If Aurora later replaces Claude with a different provider, the change is confined to `inference.service.ts` -- the calling modules (`matching`, `brand-safety`, `content-workflow`) keep the same `InferenceService` injection, same method signatures, and require no changes. This is NFR-29's "replaceable without touching campaign or payment code" at the infrastructure level, one layer below the adapter boundaries those epics established.

The two methods `InferenceService` exposes -- `completeText` and `streamText` -- are described in full in the E10 architecture document (section 2.2). Key design constraints:
- Both methods accept `correlationId: string` explicitly (NFR-32). The service logs every call with this ID, the model used, input/output token counts, duration, and outcome.
- Both methods throw `InferenceUnavailableError` (a local error class, not an HTTP exception) when the API is unreachable, times out, or when `ANTHROPIC_API_KEY` is absent. Callers handle this error at their own layer without catching HTTP exceptions.
- `InferenceService` does not read model names or token budgets from configuration itself. These are passed by the caller so each use case controls its own budget (see ADR-0066).

## Consequences

**What Aurora gains:**
- One credential lookup, one connection pool, one log-pattern for all Claude calls in the application.
- Future provider migration (Claude -> different API) is a change in one file. The three adapter modules are insulated from the change entirely.
- `correlationId` propagation and structured logging are enforced at one chokepoint rather than relying on each adapter remembering to do it.
- The pattern is consistent with how every other third-party integration in this codebase already works (email, object storage, job queues).

**What Aurora gives up:**
- `InferenceModule` is a `@Global()` module. Globals in NestJS make dependency graphs harder to reason about in isolation, since any module can implicitly depend on the service without an explicit import. This is accepted as the same tradeoff already made for `AuditModule`, `ConfigModule`, and `CommonModule` -- the services they provide are genuinely cross-cutting, and requiring every consumer to import the module explicitly would be mechanical overhead without safety benefit.
- Aurora now has an application-level dependency on a specific third-party package at the inference layer, rather than isolating it behind an interface. If the Anthropic SDK's API surface changes in a breaking way, the change must be absorbed in `InferenceService`. This is judged acceptable for a pilot: the SDK is stable, Aurora is not running multiple inference providers simultaneously, and the calling modules are already insulated from the change by the service abstraction.
