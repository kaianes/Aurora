# Epic E10, AI Creator Demo: Summary

**Author:** Kaiane Cordeiro. Aurora Project, Sprint 8. **Date:** November 23, 2026.

> **TL;DR.** All five stories are implemented and pass QA. Backend: 523/523 tests passing (re-run independently for this review, 87 files). Frontend: 218/218 passing (re-run independently, 49 files). Backend typecheck: 7 errors — 4 are the same pre-existing errors in `campaign.service.additional.spec.ts` already on record since E8; 2 are from the tenant-isolation remediation commit of October 25 (`roles.guard.spec.ts`), and 1 is from the new real-Postgres e2e harness infrastructure (`test/e2e/global-setup.ts`, missing `@types/pg`); zero errors introduced by E10's own diff. Frontend typecheck: clean. E10 is an integration-only epic: it wires the Claude API into four stub points that E3, E4, E5, and E8 architected but left as placeholders. The four ADRs (0065-0068) are followed with one disclosed deviation: the `X-Accel-Buffering: no` header required by ADR-0067 to prevent proxy buffering of the SSE stream is absent from the briefing Q&A endpoint. The default model in all three use cases is `claude-sonnet-4-5` as ADR-0066 specifies; the commit message incorrectly states `claude-haiku-4-5` -- the code is correct, the commit message is not. `InferenceService` itself has no unit spec file. The shortlist page spec file covers layout but has no test asserting the `fit_reason` text renders or that the `fit_reason_unavailable` placeholder is shown. Both gaps are recorded as open items. The architecture document's status field still reads "Proposed -- awaiting approval before backend-dev or frontend-dev begin"; the document is treated as approved for this review since the implementation is complete and merged.

## 1. Purpose

This document summarizes what was built for Epic E10 (AI Creator Demo), checks it against the four E10 ADRs (0065 through 0068) and the E10 architecture specification, reports the actual state of automated tests, and lists open items. It is the final summary document for the project.

E10 does not introduce new customer-facing capabilities beyond what E3, E4, E5, and E8 already promised. Its role is to wire the Claude API into four integration points those epics architected but left as stubs, and to seed a database state that lets a demo operator walk a coherent scenario from campaign creation to content safety check in one sitting. Every behavior this epic activates already had an adapter boundary, a data model, and acceptance criteria in the epic that owned it; E10 brings those stubs to life and makes the resulting experience legible during a walkthrough.

<p align="center"><strong>Table 1</strong></p>

<p align="center"><em>Stories in Scope for Epic E10</em></p>

<div align="center">

| Story | Priority | Persona | Status |
|---|---|---|---|
| US-10.1 Briefing Q&A powered by Claude (SSE streaming) | Must | Duda (creator) | Implemented, tested |
| US-10.2 Creator shortlist with AI fit reasoning | Must | Marina (brand) | Implemented, tested (shortlist fit_reason display has no dedicated frontend spec) |
| US-10.3 Brand safety tier-2 semantic check with Claude | Must | Marina (brand) | Implemented, tested |
| US-10.4 Animated creator onboarding "analyzing" screen | Must | Duda (creator) | Implemented, tested |
| US-10.5 Demo seed data | Must | Demo operator | Implemented (no automated test, correct by construction) |

</div>

*Note.* Priority follows the MoSCoW scale defined in the product requirements document. All five Must stories have a corresponding passing QA result. US-10.5 is not tested by an automated spec; its correctness is verified by running `npm run seed:demo` against a clean database and confirming the scenario is walkable end to end.

## 2. What Was Built

**Backend**, one new module and four existing modules extended:

- `inference/inference.module.ts` and `inference/inference.service.ts` are a new `@Global()` NestJS module (ADR-0065) that wraps the `@anthropic-ai/sdk` package. No other module in the codebase imports the SDK directly. `InferenceService` exposes two methods -- `completeText` (for non-streaming calls) and `streamText` (async generator, for briefing Q&A) -- both accepting a `correlationId` parameter (NFR-32) and throwing a local `InferenceUnavailableError` class on API or timeout failures. The `@anthropic-ai/sdk` package and its type definitions are added to `backend/package.json`; the module is registered in `AppModule`.

- `brand-safety/adapters/content-safety.adapter.ts` replaces the tier-2 stub with a real Claude call. `RealContentSafetyAdapter.resolveTier2()` now calls `InferenceService.completeText()` with the brand safety tier-2 prompt (section 5.3 of the architecture document), parses the returned JSON for a `verdict` field (`pass` | `flagged`), and returns an `EvaluateResult` carrying `aiSafetyReason` on a tier-2 `flagged` outcome (interface change per section 7.2 of the architecture document). `run-safety-check.processor.ts` writes the `aiSafetyReason` value to `safety_review_queue_item.ai_safety_reason` when a queue item is created. `review-queue.service.ts` gains a minor addition to surface this field.

- `matching/real-matching-engine.adapter.ts` extends `generateShortlist()` to call `InferenceService.completeText()` for each shortlist entry after scoring and ranking are complete, in parallel batches of `AI_FIT_REASON_BATCH_SIZE` (ADR-0068). The `GenerateShortlistEntry` interface (in `campaign/matching-engine.adapter.ts`) gains two new fields: `fitReason: string | null` and `fitReasonUnavailable: boolean`. Agency-added entries skip the generation loop and are returned with `fitReason = null` and `fitReasonUnavailable = false`. The campaign module's `generate-shortlist.processor.ts` gains two new field writes (`entry.fitReason`, `entry.fitReasonUnavailable`) from the returned entry without any logic change. `shortlist.service.ts` is updated to surface both fields through the existing shortlist GET endpoint.

- `content-workflow/creator-portal-briefing.controller.ts` gains a new POST endpoint at `/creator-portal/briefings/:briefingId/qa/:threadId/messages/ask` that persists the creator's question, then opens a Server-Sent Events stream delivering the AI response token-by-token (ADR-0067). The endpoint uses `@Res()` injection and direct `res.write()` calls, not NestJS's `@Sse()` decorator, so a POST can carry an event stream. `briefing-qa.service.ts` gains the `askQuestion()` method that orchestrates the full SSE event sequence: `question_stored`, `ai_thinking`, `token` (one per yielded token), `answer_stored`, `done`. On `InferenceUnavailableError`, it emits `error` then `done` without storing an AI message; the creator's question is always stored before any Claude call begins (US-10.1 scenario 3). `BriefingQaMessage.sender_type` gains a third value `'system'` via the `QaSenderType.SYSTEM` enum value and a CHECK constraint update in the migration.

- **Migration** `1746000000000-AiCreatorDemoSchema.ts` adds all schema changes in a single file: `campaign_shortlist_entry.fit_reason` (text, nullable), `campaign_shortlist_entry.fit_reason_unavailable` (boolean, not null, default false), `safety_review_queue_item.ai_safety_reason` (text, nullable), and the `sender_type` CHECK constraint extension to include `'system'`. The migration has a `down()` method that reverses all three changes. Entity files `campaign-shortlist-entry.entity.ts`, `safety-review-queue-item.entity.ts`, and `briefing-qa-message.entity.ts` are updated to reflect the new columns and enum value.

- **Seed script** `backend/src/database/seeds/demo.seed.ts` creates all records required by US-10.5: 10 creators (varied niches and authenticity scores), 2 brands (Bella Natural Cosméticos, NovaTech Eletrônicos) with their safety rulesets, 1 agency (Agência Pulso Digital), 2 campaigns with ready shortlists and pre-written `fit_reason` values per entry, 3 content submissions in distinct safety states (passed tier-2, flagged tier-1, tier-2 pending), and 1 briefing Q&A thread with 2 existing creator messages and no AI replies. The script implements the production guard (reading `DATABASE_URL` for `localhost`/`127.0.0.1`/`demo` or requiring `DEMO_SEED_ALLOWED=true`) and supports `--reset` for teardown and re-seed. A follow-up commit (`f986fe3`) expanded the seed for the final presentation; `npm run seed:demo:reset` is the operator's setup ritual.

**Frontend**, three existing routes extended, no new route:

- `shortlist-page.tsx` renders `fitReason` text beneath each creator card when non-null. When `fitReason` is null and `fitReasonUnavailable` is true, the card shows "Justificativa não disponível." Agency-added entries (null reason, unavailable false) show no fit reason section at all.

- `briefing-qa-page.tsx` (creator portal) replaces the plain JSON POST to the Q&A endpoint with a `fetch()`-based SSE stream reader over the new `/messages/ask` endpoint (ADR-0067, option B). The component handles all event types in the protocol: shows a "thinking" indicator on `ai_thinking`, appends token deltas live, confirms the stored message on `answer_stored`, and shows the AI-unavailability message on `error`.

- `onboarding-analyzing-page.tsx` replaces the static stub with a four-step animated sequence (US-10.4): "Verificando autenticidade", "Calculando taxa de engajamento", "Avaliando composição do público", "Gerando sua pontuação". Each step resolves at a fixed programmatic pace decoupled from actual computation latency (US-10.4 scenario 3). After the fourth step, the page transitions to the score reveal. Step label strings are externalized translation keys (NFR-27).

## 3. Compliance With ADRs and Architecture

**ADR-0065 (InferenceModule -- a single @Global() NestJS module wraps the Anthropic SDK; no other module imports the SDK directly):** followed exactly, verified by grep. The `@anthropic-ai/sdk` import appears only in `inference/inference.service.ts`. All three calling modules (`brand-safety`, `matching`, `content-workflow`) inject `InferenceService` via NestJS DI without importing the SDK. `InferenceModule` is registered in `AppModule`'s `imports` array alongside existing global modules.

**ADR-0066 (default model `claude-sonnet-4-5` for all three use cases; model names are environment variables, not hardcoded):** followed exactly in code, with one documentation inaccuracy to disclose. The commit message for `8b6fb4b` states "via claude-haiku-4-5" for both `BriefingQaService` and `RealMatchingEngineAdapter`; the actual code in both files reads `this.configService.get<string>('ANTHROPIC_MODEL_QA', 'claude-sonnet-4-5')` and `this.configService.get<string>('ANTHROPIC_MODEL_FIT_REASON', 'claude-sonnet-4-5')` respectively. The code is correct and matches ADR-0066; the commit message is not. All three model variables (`ANTHROPIC_MODEL_QA`, `ANTHROPIC_MODEL_FIT_REASON`, `ANTHROPIC_MODEL_SAFETY`) default to `claude-sonnet-4-5`. Token budgets (1024 for Q&A, 128 for fit reason, 512 for safety) are constants in each calling module, not environment variables, as the ADR specifies.

**ADR-0067 (SSE via a single POST endpoint using `@Res()` injection and `fetch()` streaming on the client):** followed in substance with one deviation. The POST endpoint at `/creator-portal/briefings/:briefingId/qa/:threadId/messages/ask` is implemented with `@Res()` and direct `res.write()` calls, not `@Sse()`. The persistence ordering is correct: the creator question is stored and `question_stored` is emitted before any Claude call begins. The SSE event sequence (`question_stored`, `ai_thinking`, `token`, `answer_stored`, `done`, `error`) matches the ADR exactly. The `Content-Type: text/event-stream`, `Cache-Control: no-cache`, and `Connection: keep-alive` headers are set.

**Deviation:** The `X-Accel-Buffering: no` header required by ADR-0067 (section "Headers the endpoint must set") is absent from `creator-portal-briefing.controller.ts`. This header disables Nginx response buffering for the SSE connection. Without it, any Nginx or similar reverse proxy in the deployment path (Railway and comparable platforms commonly proxy application traffic) will buffer the entire response before forwarding it, which defeats the token-by-token streaming purpose. The endpoint works correctly on a direct localhost connection; it may not stream correctly on the deployed platform. This is disclosed, not blocking for the demo if the deployment path is confirmed not to buffer SSE, but it should be fixed before production use.

**ADR-0068 (fit reason generation inside `RealMatchingEngineAdapter.generateShortlist()`, after scoring, in parallel batches; `GenerateShortlistEntry` interface extended; campaign module only reads the fields):** followed exactly. The `generateShortlist()` implementation in `real-matching-engine.adapter.ts` groups entries into batches after scoring, issues Claude calls concurrently with `Promise.allSettled()` per batch, marks failed entries with `fitReasonUnavailable = true`, and returns the full entry set regardless of partial failures. Agency-added entries are excluded from the generation loop. The campaign module's `generate-shortlist.processor.ts` performs only the two mechanical field writes the ADR specifies; no logic about fit reasons was added to the campaign module.

**Architecture document open questions:** All eight open questions in the stories document were resolved in the architecture document before implementation. All eight resolutions are reflected in the code: `QaSenderType.SYSTEM = 'system'` for AI messages (Q1), E10-owned migration file without touching E3's files (Q2), `ai_safety_reason` on `safety_review_queue_item` not on `safety_check` (Q3), US-10.4 frontend-only with existing stub scores (Q4), always-Portuguese prompts (Q5), `claude-sonnet-4-5` default (Q6), two-command teardown (`seed:demo` / `seed:demo:reset`) (Q7), and `fitReason = null, fitReasonUnavailable = false` for agency-added entries (Q8).

## 4. Test Results

<p align="center"><strong>Table 2</strong></p>

<p align="center"><em>Automated Test Results by Package, Final State</em></p>

<div align="center">

| Package | Command | Result |
|---|---|---|
| Backend | `npx vitest run` (from `backend/`) | 87 test files, 523 tests, all passing |
| Frontend | `npx vitest run` (from `frontend/`) | 49 test files, 218 tests, all passing |
| Backend typecheck | `npx tsc --noEmit` (from `backend/`) | 7 errors: 4 pre-existing in `campaign.service.additional.spec.ts` (same as E9), 2 pre-existing in `roles.guard.spec.ts` (introduced by tenant-isolation remediation commit `98c05a9`, Oct 25), 1 in `test/e2e/global-setup.ts` (missing `@types/pg` for the new e2e harness, outside E10's scope); zero introduced by E10 |
| Frontend typecheck | `npx tsc --noEmit` (from `frontend/`) | 0 errors |

</div>

Backend coverage specific to this epic: `content-safety.adapter.spec.ts` (updated for tier-2 AI path), `real-matching-engine.adapter.spec.ts` (updated for fit reason generation), `briefing-qa.service.spec.ts` (updated for the AI streaming path and `QaSenderType.SYSTEM`). Frontend coverage specific to this epic: `onboarding-analyzing-page.spec.tsx` (substantially extended for the animated step sequence and score reveal), `briefing-qa-page.spec.tsx` (minor update for the new SSE endpoint call). Note: `InferenceService` itself has no unit spec file. The `shortlist-page.spec.tsx` was not updated for E10 and contains no assertion for `fit_reason` text rendering or the `fit_reason_unavailable` placeholder.

## 5. Story Coverage

<p align="center"><strong>Table 3</strong></p>

<p align="center"><em>Story Coverage Against Automated Tests, Final State</em></p>

<div align="center">

| Story | Priority | Backend evidence | Frontend evidence | Final verdict |
|---|---|---|---|---|
| US-10.1 Briefing Q&A with SSE | Must | `briefing-qa.service.spec.ts` | `briefing-qa-page.spec.tsx` | Meets acceptance criteria |
| US-10.2 Shortlist fit reasoning | Must | `real-matching-engine.adapter.spec.ts` | No new spec; `shortlist-page.spec.tsx` does not cover `fit_reason` render | Meets backend acceptance criteria; frontend fit_reason display is verified by code reading, not by an automated assertion |
| US-10.3 Brand safety tier-2 | Must | `content-safety.adapter.spec.ts` | Existing review-queue-page spec unchanged | Meets acceptance criteria |
| US-10.4 Animated onboarding screen | Must | n/a (frontend-only) | `onboarding-analyzing-page.spec.tsx` | Meets acceptance criteria |
| US-10.5 Demo seed data | Must | No automated test | No automated test | Correct by construction; `npm run seed:demo` executes without error and populates all required records per the architecture document's Section 10 |

</div>

US-10.2 frontend coverage is the only gap worth flagging precisely: `shortlist-page.tsx` does render `fitReason` and the `fitReasonUnavailable` placeholder, confirmed by direct code reading, but neither the existing `shortlist-page.spec.tsx` nor any new spec file added by this epic exercises the conditional rendering of these two states.

## 6. Deviations Summary

1. **Disclosed, non-blocking, should fix before production:** `creator-portal-briefing.controller.ts` does not set the `X-Accel-Buffering: no` header on the SSE response. ADR-0067 explicitly requires it to prevent proxy buffering. The demo works on localhost; a Railway or Nginx-proxied deployment may buffer the stream and appear to deliver the full response in one batch rather than token-by-token. The fix is a one-line `res.setHeader('X-Accel-Buffering', 'no')` call before `res.flushHeaders()`.

2. **Documentation inaccuracy, code is correct:** Commit `8b6fb4b`'s message states "BriefingQaService ... via claude-haiku-4-5" and "RealMatchingEngineAdapter: fit_reason generation ... (claude-haiku-4-5)". The actual code correctly reads the model from `ANTHROPIC_MODEL_QA` and `ANTHROPIC_MODEL_FIT_REASON` environment variables, both defaulting to `claude-sonnet-4-5` per ADR-0066. The commit message is misleading; the implementation is correct.

3. **Coverage gap:** `InferenceService` has no unit spec file. The service wraps the Anthropic SDK client, throws `InferenceUnavailableError` on API failures, and logs every call with structured fields (NFR-32). None of this behavior is exercised by an automated test; correctness is established only by the indirect coverage from `content-safety.adapter.spec.ts`, `real-matching-engine.adapter.spec.ts`, and `briefing-qa.service.spec.ts`, which mock `InferenceService` at the injection boundary.

4. **Coverage gap:** `shortlist-page.spec.tsx` has no test asserting that `fitReason` text renders in a creator card, that the "Justificativa não disponível" placeholder renders when `fitReasonUnavailable = true`, or that agency-added entries show no fit reason section. The production code handles all three cases; the spec does not verify them.

5. **Architecture document status not updated:** The architecture document `docs/architecture/e10-ai-creator-demo.md` retains `Status: Proposed -- awaiting approval before backend-dev or frontend-dev begin`. The implementation is complete and merged. The status should read "Approved and implemented" for the record.

6. **No deviation found** between the code and any of the four ADRs (0065-0068) or the architecture document's data model, API contracts, prompt templates, parallelism strategy, or error handling contract, beyond the five items above.

## 7. Open Items for a Future Epic

- Fix the missing `X-Accel-Buffering: no` header in `creator-portal-briefing.controller.ts` before the first production deployment where a reverse proxy sits in front of the application server.
- Add a unit spec for `InferenceService` covering at minimum: `completeText` success path (logs `correlationId`, `inputTokens`, `outputTokens`, `durationMs`), `completeText` on API error (throws `InferenceUnavailableError`), `streamText` token-by-token yield, and `streamText` on `InferenceUnavailableError` before first token.
- Add spec assertions to `shortlist-page.spec.tsx` for the three `fitReason` / `fitReasonUnavailable` / agency-added cases.
- Update the architecture document's status field from "Proposed" to "Approved and implemented."
- **Carried from E9 and all prior epics:** Register `TenantContextMiddleware` correctly in `app.module.ts` so every tenant-isolation RLS policy this platform has ever written becomes an engaged second line of defense. This is the most-repeated unresolved item across all ten epics (E1 through E10), confirmed independently by grep in every epic's summary.
- **Carried from E6 and repeated by E7, E8, E9:** Stand up a real-Postgres integration-test harness. The e2e harness infrastructure (`test/e2e/global-setup.ts`) was added as part of the advisor feedback plan this sprint, but `@types/pg` is missing and the harness has not been fully wired into the test runner. Completing this would let E10's RLS schema changes (the additive columns and the `sender_type` CHECK constraint) be verified against a running database, not only by migration inspection.
- If `AuthenticityScoringAdapter` is ever wired to a live model, the animated step timing in US-10.4 should be revisited: the current fixed programmatic delay is correct for a stub but would look detached from reality if real computation latency were visible.
- Decide whether fit reason generation (US-10.2) should run for agency-added shortlist entries. ADR-0068 specifies `fitReason = null` for these entries; the product question of whether a prompt-based explanation of an agency override is useful is open.

## References

Aurora Project Team. (2026). *ADR-0011: matching engine adapter pattern*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0021: content safety adapter pattern*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0022: safety check timeout and check_unavailable status*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0028: briefing Q&A thread design*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0065: Claude API client wrapped in a dedicated InferenceModule*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0066: Claude model choice and token budgets for E10*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0067: Server-Sent Events for briefing Q&A AI response streaming*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *ADR-0068: fit reason generation at shortlist-generation time, not on-demand*. Internal architecture decision record, Aurora project.

Aurora Project Team. (2026). *E10, AI Creator Demo: Stories*. Internal product requirements document, Aurora project.

Aurora Project Team. (2026). *E10, AI Creator Demo: Technical architecture*. Internal architecture specification, Aurora project.

Aurora Project Team. (2026). *E9, Agency multi-client operations: Summary*. Internal epic summary, Aurora project.

Aurora Project Team. (2026). *Product requirements document*. Internal product requirements document, Aurora project.
