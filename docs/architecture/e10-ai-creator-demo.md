# E10 -- AI Creator Demo: Technical Architecture

**Date:** 2026-11-16
**Epic:** E10 -- AI Creator Demo
**Status:** Proposed -- awaiting approval before backend-dev or frontend-dev begin

---

## Open Questions: Explicit Resolutions

The stories document lists eight open questions. All eight are resolved here before any implementation begins. Backend-dev and frontend-dev must not resolve them independently.

| # | Question | Resolution |
|---|---|---|
| 1 | `sender_type` schema for AI messages | Add `'system'` as a third enum value to `QaSenderType`. See section 3. The UI renders `system` messages with an AI icon, distinct from `creator` and `brand` messages. |
| 2 | `fit_reason` migration ownership | E10 owns a new migration file `1746000000000-AiCreatorDemoSchema.ts`. It is purely additive (nullable columns on existing tables, one enum value). E3's migration files are not touched. |
| 3 | `ai_safety_reason` column placement | On `safety_review_queue_item`. The reason for a tier-2 pass is not persisted -- the `safety_check.status = 'passed'` and `tier_reached = 'tier2'` are sufficient to record a clean tier-2 outcome. Only flagged items have a queue row, and only flagged items need a plain-language reason for the reviewer. |
| 4 | US-10.4 and a live authenticity scoring adapter | US-10.4 is frontend-only. The existing `AuthenticityScoringAdapter` stub returns synthetic scores. E10 does not wire a live model. |
| 5 | Language of Claude responses | Claude always responds in Brazilian Portuguese. Every prompt in this document includes "Responda SEMPRE em Portugues Brasileiro" as the first instruction, regardless of the language of the input. |
| 6 | Model selection and cost | Default model `claude-sonnet-4-5` for all three use cases. Each use case reads its model from a dedicated environment variable. See section 2. |
| 7 | Demo seed data teardown | Two commands: `npm run seed:demo` (fail-fast if seed data already exists -- exits non-zero with a clear error message) and `npm run seed:demo:reset` (tears down existing seed data and re-runs `seed:demo`). |
| 8 | Fit reason for agency-added entries | `fit_reason = null` and `fit_reason_unavailable = false` for all entries with `origin = 'agency_added'`. No Claude call is made for these entries. The UI renders them with their numeric score (or no score) and no fit reason text. |

---

## 1. Overview

E10 is an integration-only epic. It does not introduce new customer-facing capabilities beyond what E3, E4, E5, and E8 already promised. It wires the Claude API into four stub points those epics left as placeholders, and provides the demo seed data needed to walk a coherent scenario from campaign creation to content safety check in one sitting.

**Boundary: AI inference only, no new business logic.**

Every behavioral rule -- who can see the shortlist, what constitutes a safety violation, who can submit a briefing question, how the authenticity score is computed -- is defined by the owning epic (E3, E4, E5, E8 respectively). E10's job is to call Claude at the four points those epics marked as stubs, store the response in the columns those epics specified, and return it through the existing endpoints those epics defined. E10 adds no new business rules and must not modify any behavior outside the four adapter boundaries it activates.

**What this epic adds:**

- A new `InferenceModule` with an `InferenceService` that wraps the `@anthropic-ai/sdk` package. This module is consumed by the `matching`, `brand-safety`, and `content-workflow` modules; it is never called directly from the HTTP layer.
- A real implementation of `RealContentSafetyAdapter.resolveTier2()`, replacing the current stub with a Claude call.
- An extension to `RealMatchingEngineAdapter.generateShortlist()` that generates fit reason text for each entry after scoring is complete.
- An extension to the briefing Q&A message creation endpoint that calls Claude and streams the response.
- An animated onboarding screen at `/creator-portal/onboarding/analyzing` (frontend-only, no backend changes).
- A CLI seed script: `npm run seed:demo` and `npm run seed:demo:reset`.
- A single additive database migration: `1746000000000-AiCreatorDemoSchema.ts`.

**Modules touched, with the nature of each change:**

| Module | Nature of change |
|---|---|
| `inference` | New module. Provides `InferenceService`. |
| `matching` | Extend `RealMatchingEngineAdapter.generateShortlist()` to call `InferenceService` after scoring. Extend `GenerateShortlistEntry` interface to include `fitReason` and `fitReasonUnavailable`. |
| `brand-safety` | Replace `RealContentSafetyAdapter.resolveTier2()` stub with a real Claude call. Extend `EvaluateResult` to carry `aiSafetyReason` on tier-2 flagged outcomes. The calling job writes this to `safety_review_queue_item`. |
| `content-workflow` | Add a new endpoint for AI-augmented Q&A submission with SSE response streaming. Extend the `BriefingQaMessage` entity to include `sender_type = 'system'`. |
| `campaign` | The shortlist job writer gains two new field writes (`fitReason`, `fitReasonUnavailable`) from `GenerateShortlistEntry`. No logic changes. |
| Frontend (creator portal) | Animated onboarding screen. The briefing Q&A submission flow consumes the new SSE endpoint. The shortlist view renders `fit_reason` text. |
| Seed script | New CLI script at `backend/src/database/seeds/demo.seed.ts`. |

---

## 2. Claude API Integration

### 2.1 Package and Module

Install `@anthropic-ai/sdk` as a production dependency. The exact version must be pinned in `package.json`.

Create a new NestJS module at `backend/src/inference/`. Mark it `@Global()` so it does not need to be imported explicitly by each consuming module.

```
backend/src/inference/
  inference.module.ts       -- @Global() module; provides InferenceService
  inference.service.ts      -- wraps Anthropic client, see interface below
```

`InferenceModule` is added to the `imports` array of `AppModule`.

### 2.2 InferenceService Interface

`InferenceService` exposes two methods. It does not expose the Anthropic client directly. No other module in the codebase imports from `@anthropic-ai/sdk`; all Claude calls flow through this service.

**completeText** -- for non-streaming calls (fit reasoning, brand safety tier-2):

```
completeText(params: {
  model: string;
  maxTokens: number;
  system: string;
  user: string;
  correlationId: string;
  timeoutMs: number;
}): Promise<string>
```

Returns the full text content of Claude's response. Throws `InferenceUnavailableError` (a local error class, not an HTTP exception) if the API returns an error, times out, or if `ANTHROPIC_API_KEY` is absent or empty.

**streamText** -- for streaming calls (briefing Q&A):

```
streamText(params: {
  model: string;
  maxTokens: number;
  system: string;
  user: string;
  correlationId: string;
  timeoutMs: number;
}): AsyncGenerator<string>
```

Yields tokens as they arrive. Throws `InferenceUnavailableError` before the first token if the initial API handshake fails. After the stream starts, errors mid-stream are caught by the caller (the endpoint handler), which emits an error SSE event and closes the response.

### 2.3 Environment Variables

All configuration is supplied externally (NFR-30). No value in this list may be hardcoded.

| Variable | Purpose | Required | Default |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Authenticates every Claude call | Yes | (none -- InferenceService throws InferenceUnavailableError on every call if absent) |
| `ANTHROPIC_MODEL_QA` | Model for briefing Q&A | No | `claude-sonnet-4-5` |
| `ANTHROPIC_MODEL_FIT_REASON` | Model for shortlist fit reasoning | No | `claude-sonnet-4-5` |
| `ANTHROPIC_MODEL_SAFETY` | Model for brand safety tier-2 | No | `claude-sonnet-4-5` |
| `AI_FIT_REASON_BATCH_SIZE` | Parallel calls per batch for fit reasoning | No | `10` |
| `AI_FIT_REASON_TIMEOUT_MS` | Timeout per fit reason call | No | `10000` |
| `AI_QA_TIMEOUT_MS` | Timeout for briefing Q&A stream start | No | `30000` |
| `AI_SAFETY_TIMEOUT_MS` | Timeout for tier-2 safety call | No | `60000` |

`InferenceService` reads these via NestJS `ConfigService` at method-call time, not at module initialization, so a misconfigured key fails closed at the first call rather than preventing the application from starting.

### 2.4 Token Budgets

| Use case | Approximate input tokens | Max output tokens | Rationale |
|---|---|---|---|
| Briefing Q&A | 800-3000 (briefing body + question) | 1024 | Enough for a thorough two-paragraph answer; the full briefing body is always included per US-10.1 scenario 2 |
| Fit reasoning (per entry) | 300-600 (campaign brief + creator profile) | 128 | 1-2 sentences as specified by US-10.2; short output keeps latency low for 100-creator batches |
| Brand safety tier-2 | 500-2000 (content channels + ruleset) | 512 | 1-3 sentences of reason per US-10.3 scenario 2; structured JSON output with reason field |

### 2.5 Logging and Correlation (NFR-32)

Every Claude API call log entry must carry:
- `correlationId` from the calling request (passed explicitly to `completeText` and `streamText`)
- `model` used
- `useCase` label (`qa`, `fit_reason`, `safety_tier2`)
- `inputTokens` and `outputTokens` (from the response usage metadata)
- `durationMs`
- `outcome` (`success`, `error`, `timeout`)

Log at `INFO` level on success. Log at `WARN` level on timeout or API error, including the error code returned by the API (but never the prompt or response content, which may contain creator PII).

---

## 3. Data Model Changes

### 3.1 Additive Changes Only

E10 makes no breaking changes to any existing schema. All changes are additive (new nullable columns, one new enum value). No existing column is modified.

### 3.2 `campaign_shortlist_entry` -- Two New Columns

```sql
ALTER TABLE campaign_shortlist_entry
  ADD COLUMN fit_reason           TEXT        NULL,
  ADD COLUMN fit_reason_unavailable BOOLEAN   NOT NULL DEFAULT false;
```

**`fit_reason`**: The plain-language explanation Claude generated for why this creator fits this campaign. Null for agency-added entries and for entries where the Claude call failed (see `fit_reason_unavailable`).

**`fit_reason_unavailable`**: True when a Claude call was attempted and failed (timeout, API error, rate limit). False when no call was attempted (agency-added entry) or when the call succeeded. This field lets the UI distinguish "reason not generated" from "reason generation failed" without reading the reason text itself.

### 3.3 `safety_review_queue_item` -- One New Column

```sql
ALTER TABLE safety_review_queue_item
  ADD COLUMN ai_safety_reason     TEXT        NULL;
```

**`ai_safety_reason`**: The plain-language explanation Claude returned for why the content was flagged. Null when `reason_category = 'check_unavailable'` (Claude was unavailable, not a ruling). Populated only for `reason_category = 'rule_violation'` entries that reached tier-2.

### 3.4 `briefing_qa_message.sender_type` -- New Enum Value

The existing `sender_type` column is a `text` column with a PostgreSQL CHECK constraint (TypeORM's `type: 'text', enum: QaSenderType` pattern). The current constraint is:

```sql
CHECK (sender_type IN ('creator', 'brand'))
```

The migration replaces this with:

```sql
CHECK (sender_type IN ('creator', 'brand', 'system'))
```

The TypeORM entity `QaSenderType` enum gains the value `SYSTEM = 'system'`.

**Semantics of `sender_type = 'system'`:**
- `senderUserId` is null (the system is not a human user)
- `senderCreatorId` is null
- The message body is Claude's answer, stored as the complete response (not streamed tokens)
- The existing "is unanswered" heuristic -- "computed from whether the last message has `sender_type = 'creator'`" -- continues to work correctly, since `system` is not `creator`
- The UI renders `system` messages with an AI indicator (not the brand's avatar or the creator's avatar)

### 3.5 Migration File

**File:** `backend/src/database/migrations/1746000000000-AiCreatorDemoSchema.ts`

This single migration file contains all three schema changes in sections 3.2-3.4 above. It has no dependencies on any E10 application code and can be run independently. The `down()` method reverses each change.

**TypeORM entity files that must be updated alongside the migration:**
- `campaign-shortlist-entry.entity.ts`: add `fitReason: string | null` and `fitReasonUnavailable: boolean`
- `safety-review-queue-item.entity.ts`: add `aiSafetyReason: string | null`
- `briefing-qa-message.entity.ts`: add `SYSTEM = 'system'` to `QaSenderType` enum

---

## 4. API Contracts

### 4.1 Existing Endpoints Extended

Two existing endpoints gain new fields in their response payloads. These are backward-compatible additions: new nullable fields appear in the response; no existing field is removed or renamed.

**GET /campaigns/:id/shortlist -- entry shape extension**

The endpoint returns a shortlist object containing an `entries` array. Each entry gains two new fields:

```jsonc
{
  "id": "uuid",
  "creatorId": "uuid",
  "rank": 1,
  "fitScore": 0.87,
  "matchedAttributes": ["interests:beleza"],
  "fitReason": "A taxa de engajamento de 8.3% de @dudamartins e seu nicho em beleza sustentavel estao diretamente alinhados com o publico-alvo de mulheres de 18 a 30 anos desta campanha de protecao solar vegana.",
  "fitReasonUnavailable": false,
  "origin": "system_ranked",
  "decision": "approved",
  "included": true,
  "addedByUserId": null,
  "decisionByUserId": "uuid",
  "decisionAt": "2027-01-15T14:00:00Z",
  "createdAt": "2027-01-14T09:00:00Z",
  "updatedAt": "2027-01-15T14:00:00Z"
}
```

When `fitReason` is null and `fitReasonUnavailable` is false, the entry is agency-added. When `fitReason` is null and `fitReasonUnavailable` is true, the generation attempt failed. The frontend renders these two null cases differently: agency-added entries show no fit reason section at all; unavailable entries show a placeholder ("Justificativa nao disponivel").

**Auth:** Existing auth (brand owner, brand manager, agency operator, agency admin). No change.

**GET /safety/review-queue/:id -- item shape extension**

```jsonc
{
  "id": "uuid",
  "safetyCheckId": "uuid",
  "campaignId": "uuid",
  "contentSubmissionId": "uuid",
  "reasonCategory": "rule_violation",
  "status": "pending",
  "decisionReason": null,
  "decidedByUserId": null,
  "decidedAt": null,
  "aiSafetyReason": "O texto da legenda contem a expressao 'parece que cura qualquer dano solar', que implica um beneficio medico nao comprovado. Isso semanticamente viola a regra de topico proibido para alegacoes de saude desta campanha, embora nenhuma palavra-chave especifica da regra apareca literalmente.",
  "createdAt": "2027-01-15T14:00:00Z",
  "updatedAt": "2027-01-15T14:00:00Z"
}
```

`aiSafetyReason` is null when `reasonCategory = 'check_unavailable'`. It is null for tier-1 flagged items (tier-1 uses exact rule triggers, not AI reasoning). It is populated for tier-2 flagged items.

**Auth:** Existing auth (brand owner, brand manager, agency operator, agency admin). No change.

### 4.2 New Endpoint: Briefing Q&A with AI Streaming

**POST /creator-portal/briefings/:briefingId/qa/:threadId/messages/ask**

This is a new endpoint distinct from the plain message creation endpoint (`POST .../messages`). It performs two operations in sequence: persists the creator's question, then opens a Server-Sent Events stream that delivers the AI response token-by-token.

**Auth:** `CreatorAuthGuard` and `@CreatorPortalRoute()` decorator (ADR-0064 pattern). The creator must have an active, non-expired opportunity on the campaign this briefing belongs to. If not, the endpoint returns HTTP 403 before persisting anything or starting the stream.

**Request:**
```json
{
  "body": "string (1 to 2000 characters, required)"
}
```

**Success response:** HTTP 200 with `Content-Type: text/event-stream`. NestJS's `@Sse()` decorator is GET-only. This endpoint uses `@Res()` injection and writes directly to the response stream using the raw Node.js HTTP response object. The controller must set `Content-Type: text/event-stream`, `Cache-Control: no-cache`, and `Connection: keep-alive` headers before writing any events. All events use standard SSE format (`data: <JSON>\n\n`).

**SSE event sequence (normal case):**

```
data: {"type":"question_stored","messageId":"uuid","body":"...","senderType":"creator","createdAt":"ISO8601"}\n\n

data: {"type":"ai_thinking"}\n\n

data: {"type":"token","delta":"A "}\n\n
data: {"type":"token","delta":"taxa "}\n\n
... (one event per token)

data: {"type":"answer_stored","messageId":"uuid","body":"<complete answer text>","senderType":"system","createdAt":"ISO8601"}\n\n

data: {"type":"done"}\n\n
```

The `question_stored` event is emitted before the Claude API call begins. The question is persisted regardless of whether Claude succeeds.

The `answer_stored` event carries the complete answer text as well as the new message ID. The frontend should use this event (not the accumulated tokens) to store the final message state, since the stream may carry formatting that only assembles correctly at the end.

**SSE event sequence (AI unavailable):**

```
data: {"type":"question_stored","messageId":"uuid","body":"...","senderType":"creator","createdAt":"ISO8601"}\n\n

data: {"type":"error","error":"ai_unavailable"}\n\n

data: {"type":"done"}\n\n
```

The question is still persisted. No AI message is stored. The frontend clears the thinking indicator and shows the localized message: "Uma resposta automatica nao esta disponivel no momento. Sua pergunta foi salva e pode ser respondida pela equipe da marca."

**Error responses (before the stream starts):**

| Condition | HTTP status | Body |
|---|---|---|
| Creator has no active opportunity on this campaign | 403 | `{ "error": { "code": "INSUFFICIENT_PRIVILEGES", ... } }` (standard Aurora error shape) |
| Briefing or thread not found | 404 | `{ "error": { "code": "NOT_FOUND", ... } }` |
| `body` missing or over 2000 characters | 422 | `{ "error": { "code": "VALIDATION_ERROR", ... } }` |

**Flow inside the controller (step-by-step):**

1. Validate access: resolve briefing, verify creator has an active opportunity.
2. Validate request body.
3. Set SSE headers and begin the event stream.
4. Persist the creator message (`sender_type = 'creator'`, `sender_creator_id` = resolved creator ID). Emit `question_stored`.
5. Load the full briefing body from the `BRIEFING` row (dos, donts, deliverable spec, deadline, reference examples). Never use a cached or summarized version.
6. Emit `ai_thinking`.
7. Call `InferenceService.streamText(...)` with the prompt from section 5.1. For each token yielded, emit a `token` event.
8. Accumulate the full response text.
9. Persist the AI message (`sender_type = 'system'`, `sender_user_id = null`, `sender_creator_id = null`). Emit `answer_stored`.
10. Emit `done`. Close the response.

If step 7 throws `InferenceUnavailableError` or times out, skip steps 8-9 and emit `error` then `done`.

The correlation ID from the existing `CorrelationIdInterceptor` is passed to `InferenceService.streamText()` (NFR-32).

### 4.3 No New Endpoints for US-10.4 or US-10.5

US-10.4 (animated onboarding screen) is entirely frontend-only. The existing `GET /creator-portal/onboarding/status` endpoint (or equivalent from E8) already returns the computed authenticity score. No backend changes are needed.

US-10.5 (demo seed data) is a CLI script run outside the HTTP server. It has no API endpoint.

---

## 5. Prompt Designs

These prompts are the exact templates backend-dev must use. They must not be altered without updating this document and obtaining a new architecture approval.

The placeholder syntax is `{{variable}}`. Backend-dev substitutes real values by string interpolation before passing to `InferenceService`. All substituted values must be sanitized to remove any user-supplied text that could break out of the intended prompt structure (specifically: strip bare backticks and angle brackets from creator-submitted content fields before including them in prompts).

### 5.1 Briefing Q&A Prompt

**System message:**

```
Voce e um assistente da plataforma Aurora, especializado em responder perguntas de criadores de conteudo sobre briefings de campanhas de marketing.

Instrucoes:
- Responda SEMPRE em Portugues Brasileiro, independente do idioma da pergunta.
- Use exclusivamente as informacoes presentes no briefing abaixo. Nao invente detalhes nao listados.
- Seja direto, cordial e especifico. Cite o trecho relevante do briefing quando necessario.
- Se a resposta nao estiver claramente definida no briefing, informe isso ao criador e sugira que ele entre em contato com a marca.
- Responda em no maximo 3 paragrafos curtos.
```

**User message:**

```
Briefing da campanha "{{campaign_name}}":

O que e permitido fazer (dos):
{{dos_items_as_bullet_list}}

O que nao e permitido (donts):
{{donts_items_as_bullet_list}}

Especificacao do deliverable:
- Formato: {{deliverable_spec_format}}
- Quantidade de pecas: {{deliverable_spec_quantity}}
- Hashtags obrigatorias: {{deliverable_spec_mandatory_hashtags}}
- Limite de caracteres da legenda: {{deliverable_spec_caption_length_limit}}
- Notas adicionais: {{deliverable_spec_notes}}

Prazo de entrega: {{briefing_deadline}}

Exemplos de referencia fornecidos pela marca:
{{reference_examples_as_bullet_list}}

Pergunta do criador:
{{creator_question_body}}
```

If a field (e.g., `reference_examples`) is null or empty, replace that entire block with `(nao informado)`. Never leave `{{variable}}` unreplaced.

### 5.2 Fit Reasoning Prompt

**System message:**

```
Voce e um assistente da plataforma Aurora. Sua tarefa e gerar uma justificativa de compatibilidade entre um criador de conteudo e uma campanha especifica de marketing.

Instrucoes:
- Responda SEMPRE em Portugues Brasileiro.
- Escreva exatamente 1 ou 2 frases.
- Mencione pelo menos um sinal concreto e quantitativo (taxa de engajamento, tamanho do publico, nicho especifico, pontuacao de autenticidade).
- Relacione diretamente o perfil do criador ao objetivo desta campanha em especifico.
- Se a compatibilidade for parcial, seja honesto sobre isso sem ser negativo.
- Nao repita apenas o nome do criador ou o titulo da campanha sem contextualizar a relacao entre eles.
```

**User message:**

```
Campanha: {{campaign_name}}
Objetivo da campanha: {{campaign_brief_or_message}}
Publico-alvo: {{audience_targeting_description}}
Formatos de entrega solicitados: {{deliverable_formats_list}}

Criador: {{creator_handle}}
Nicho de conteudo: {{creator_content_niche}}
Tamanho do publico: {{creator_audience_size}} seguidores
Taxa de engajamento: {{creator_engagement_rate}}%
Pontuacao de autenticidade: {{creator_authenticity_score}}/100
Atributos da campanha satisfeitos por este criador: {{matched_attributes_list}}

Gere a justificativa de compatibilidade para este criador nesta campanha.
```

`audience_targeting_description` is a plain-text summary of the `AudienceTargeting` JSON (e.g., "Mulheres de 18 a 30 anos interessadas em beleza sustentavel, localizadas no Brasil"). Backend-dev must render this from the structured `audienceTargeting` object before sending the prompt; Claude must not receive raw JSON.

`matched_attributes_list` is a human-readable rendering of `matchedAttributes` (e.g., "nicho de beleza (compativel com 'interests:beleza')"). If empty, replace with "nenhum atributo especifico identificado".

### 5.3 Brand Safety Tier-2 Prompt

**System message:**

```
Voce e um avaliador de seguranca de marca da plataforma Aurora. Sua tarefa e analisar semanticamente o conteudo submetido por um criador e determinar se ele viola as regras de seguranca de marca da campanha.

Instrucoes:
- Responda SEMPRE em Portugues Brasileiro.
- Analise o conteudo semanticamente. Uma violacao pode estar presente mesmo que nenhuma palavra exata da regra apareca no texto.
- Se houver violacao, identifique qual regra foi violada (cite o tipo e a definicao da regra) e em qual canal foi detectada (legenda, texto_na_tela ou transcript_de_audio).
- Se nao houver violacao semantica, retorne verdict "pass".
- Responda com um objeto JSON valido. Nada antes e nada depois do JSON.
```

**User message:**

```
Regras de seguranca de marca desta campanha:
{{#each effective_rules}}
- Regra {{rule_id}}: Tipo "{{rule_type}}", Definicao: {{rule_definition_summary}}
{{/each}}

Conteudo submetido para avaliacao:
{{#if caption_text}}
Canal "legenda": "{{caption_text}}"
{{/if}}
{{#if on_screen_text}}
Canal "texto_na_tela": "{{on_screen_text}}"
{{/if}}
{{#if audio_transcript}}
Canal "transcript_de_audio": "{{audio_transcript}}"
{{/if}}

Avalie se o conteudo viola alguma das regras acima semanticamente.
Responda com JSON no seguinte formato exato, sem nenhum texto fora do JSON:
{
  "verdict": "pass",
  "reason": null
}
ou
{
  "verdict": "flagged",
  "reason": "Explicacao em Portugues Brasileiro de qual regra foi violada, em qual canal, e por que o conteudo semanticamente implica a violacao. Maximo 3 frases."
}
```

`rule_definition_summary` is a human-readable single-line rendering of the rule definition JSON. For `prohibited_topic`: use `definition.topic` directly. For `restricted_language`: use `"padrao: {{definition.pattern}}"`. For `competitor_mention`: use `"concorrente: {{definition.competitor_name}}"`.

The `verdict` field value is extracted by parsing the JSON response. If the response cannot be parsed as valid JSON, treat it as a tier-2 failure (`InferenceUnavailableError`). The `reason` field is used as the `ai_safety_reason` stored in the queue item.

---

## 6. Error Handling Contract

### 6.1 Briefing Q&A (US-10.1)

| Failure | What the backend does | What the frontend shows |
|---|---|---|
| Claude API error or timeout during streaming | Emit `{ "type": "error", "error": "ai_unavailable" }` SSE event, then `{ "type": "done" }`. Do not store an AI message. The creator question message is already stored. | Clear the thinking indicator. Show the localized message: "Uma resposta automatica nao esta disponivel no momento. Sua pergunta foi salva e pode ser respondida pela equipe da marca." |
| `ANTHROPIC_API_KEY` absent | Same SSE error event as above -- InferenceService throws InferenceUnavailableError before the API call. | Same UI message. |
| Access check fails (no active opportunity) | HTTP 403 before the stream opens. The question is never stored. | Standard Aurora 403 error handling. |

The question is **never silently lost** because the AI call failed. The `question_stored` SSE event is emitted before any Claude call begins.

### 6.2 Fit Reasoning (US-10.2)

| Failure | What the backend does | What the frontend shows |
|---|---|---|
| Claude call fails for one or more entries (timeout, rate limit, API error) | Write `fit_reason = null`, `fit_reason_unavailable = true` for the affected entries. The shortlist job continues to completion. | Entry card shows a placeholder: "Justificativa nao disponivel." The numeric `fit_score` and `matched_attributes` are still shown. |
| `ANTHROPIC_API_KEY` absent | All fit reason calls fail with InferenceUnavailableError. All entries get `fit_reason_unavailable = true`. | Same placeholder on every entry. |
| Shortlist job overall | The shortlist status becomes `'ready'` when scoring is complete, regardless of partial reasoning failures. It never becomes `'failed'` because fit reason generation failed. |

Fit reason failures never block or delay the shortlist from becoming `'ready'`.

### 6.3 Brand Safety Tier-2 (US-10.3)

| Failure | What the backend does | What the frontend shows |
|---|---|---|
| Claude API error or timeout | `safety_check.status = 'check_unavailable'`, `tier_reached = 'tier2'`. A `safety_review_queue_item` is created with `reason_category = 'check_unavailable'`, `ai_safety_reason = null`. | Existing review queue UI shows the item as unavailable check. The reviewer sees no AI reason (the queue item shows `reason_category = 'check_unavailable'`). |
| Response is not valid JSON | Treated as an API error; same as above. | Same. |
| Campaign has no ruleset | The check resolves to `status = 'passed'` without a tier-2 call. Claude is not called. | No queue item is created; content proceeds to the brand approval gate. |
| `ANTHROPIC_API_KEY` absent | InferenceUnavailableError; same as API error. | Same. |

The `AI_SAFETY_TIMEOUT_MS` hard timeout (default 60 seconds) is applied to the Claude call. This is well inside the p95 <= 5-minute budget of NFR-03. The existing 10-minute outer safety check timeout (ADR-0022) bounds the absolute worst case.

---

## 7. Interface Changes Inside Module Boundaries

### 7.1 `GenerateShortlistEntry` (campaign module, `matching-engine.adapter.ts`)

Two new fields added. This is an interface change inside the matching adapter contract.

```typescript
export interface GenerateShortlistEntry {
  creatorId: string;
  rank: number;
  fitScore: number;
  matchedAttributes: string[];
  fitReason: string | null;           // NEW -- null for agency-added or failed calls
  fitReasonUnavailable: boolean;      // NEW -- true when call was attempted and failed
}
```

The campaign module's shortlist job writer gains two new field writes (`entry.fitReason`, `entry.fitReasonUnavailable`) from the returned entry. No other logic in the campaign module changes.

### 7.2 `EvaluateResult` (brand-safety module, `content-safety.adapter.ts`)

Extended to carry `aiSafetyReason` on tier-2 flagged outcomes. The calling job in `brand-safety` reads this field when creating the `safety_review_queue_item` row.

```typescript
export type EvaluateResult =
  | { outcome: 'pass'; tierReached: 'tier1' | 'tier2' }
  | { outcome: 'flagged'; tierReached: 'tier1'; triggers: EvaluateTrigger[] }
  | { outcome: 'flagged'; tierReached: 'tier2'; triggers: EvaluateTrigger[]; aiSafetyReason: string | null };
```

`aiSafetyReason` is null when the tier-2 call failed. It is non-null when Claude returned a valid flagged verdict.

### 7.3 `GenerateShortlistInput` (campaign module, `matching-engine.adapter.ts`)

One new field added to give `RealMatchingEngineAdapter` the campaign context it needs for fit reason generation.

```typescript
export interface GenerateShortlistInput {
  // ...existing fields unchanged...
  campaignName: string;                   // NEW -- campaign display name for the prompt
  campaignBriefSummary: string | null;    // NEW -- campaign brief/message text; null if not set
}
```

The calling job in the campaign module already has the campaign entity loaded; these fields are populated from `campaign.name` and `campaign.message` (or equivalent brief field) before calling the adapter.

---

## 8. Fit Reason Generation: Parallelism and Latency

US-10.2 scenario 3 requires that fit reason generation for 100 creators completes within the NFR-01 budget of p95 <= 60 seconds total for the entire shortlist job.

**Strategy:** After scoring and ranking are complete, the matching adapter generates fit reasons in parallel batches. The batch size is `AI_FIT_REASON_BATCH_SIZE` (default 10). Within each batch, all calls are issued concurrently via `Promise.all()`. Batches run sequentially.

**Timing estimate at the default model and batch size:**

- 100 entries / 10 per batch = 10 batches
- Each batch: 10 concurrent calls, each approximately 1-3 seconds at 128 output tokens on `claude-sonnet-4-5`
- Batch latency: ~3 seconds p95 (the slowest of 10 concurrent calls)
- 10 batches: ~30 seconds
- Scoring + database writes: ~5-10 seconds
- Total: ~35-40 seconds, within the 60-second budget

If a single entry's call fails (throws or times out), it is caught inside the `Promise.allSettled()` wrapper for that batch position. The entry is written with `fit_reason = null` and `fit_reason_unavailable = true`. The remaining entries in the batch are unaffected.

Agency-added entries (`origin = 'agency_added'`) are excluded from the batch entirely. No Claude call is made for them. They are written with `fit_reason = null` and `fit_reason_unavailable = false`.

---

## 9. US-10.4: Animated Onboarding Screen (Frontend-Only)

No backend changes required for this story. The existing `AuthenticityScoringAdapter` stub returns synthetic scores. E10 does not wire a live model.

**Frontend contract with existing backend:**

The existing endpoint that returns the creator's computed authenticity score (from E8) already supplies the numeric score and signal breakdown needed by the score reveal screen. Backend-dev must confirm the endpoint name and response shape for frontend-dev before frontend-dev begins US-10.4.

**Animation timing requirement:** The four-step sequence must play at a fixed programmatic pace regardless of when the backend response arrives. The animation timing is decoupled from real computation latency. If the backend response is available synchronously (as the stub is), the animation still plays its full sequence.

**Step labels (must be externalized for translation per NFR-27):**

| Translation key | Brazilian Portuguese value |
|---|---|
| `onboarding.analyzing.step1` | Verificando autenticidade |
| `onboarding.analyzing.step2` | Calculando taxa de engajamento |
| `onboarding.analyzing.step3` | Avaliando composicao do publico |
| `onboarding.analyzing.step4` | Gerando sua pontuacao |

---

## 10. US-10.5: Demo Seed Data

### 10.1 Script Location and Commands

**Script file:** `backend/src/database/seeds/demo.seed.ts`

The seed script is a standalone Node.js/TypeScript script that connects to the database using the TypeORM data source configuration. It does not start the NestJS application.

```
npm run seed:demo         -- Populates seed data. Fails fast if any seed record already exists.
npm run seed:demo:reset   -- Tears down all seed data, then runs seed:demo.
```

**NPM script definition in `package.json`:**
```json
"seed:demo": "ts-node -r tsconfig-paths/register src/database/seeds/demo.seed.ts",
"seed:demo:reset": "ts-node -r tsconfig-paths/register src/database/seeds/demo.seed.ts --reset"
```

### 10.2 Production Guard (NFR-30)

The script reads the `DATABASE_URL` or `DATABASE_HOST` environment variable and checks for the string `demo` or `local` in the value. If neither is present, it also checks for a `DEMO_SEED_ALLOWED=true` environment variable. If none of these conditions is met, the script prints a clear error message naming the detected environment indicator and exits with code 1. No records are written.

The check is an explicit guard at the top of the script, not implied by convention. Its logic is:
1. If `DEMO_SEED_ALLOWED=true`, proceed.
2. If `DATABASE_URL` contains `localhost`, `127.0.0.1`, or `demo`, proceed.
3. Otherwise, print: `"[seed:demo] RECUSADO: Ambiente nao reconhecido como demo/local. Defina DEMO_SEED_ALLOWED=true para forcar a execucao."` and exit 1.

### 10.3 Idempotency Behavior

**`npm run seed:demo`** (without `--reset`): The script checks for the existence of a creator with `handle = '@dudamartins'`. If found, it prints: `"[seed:demo] Dados de seed ja existem. Execute 'npm run seed:demo:reset' para recriar."` and exits 1. No partial writes occur.

**`npm run seed:demo:reset`**: Deletes all records associated with the seed data (by handle, campaign name, or other seed-specific identifiers) and then runs the full seed. The teardown order respects foreign key constraints (delete in reverse insertion order).

### 10.4 Required Seed Records

All text values must be in Brazilian Portuguese. All `fit_reason` values in shortlist entries are pre-written strings, not generated by Claude at seed time.

**Creators (10 total)**

| Handle | Niche | Audience size | Engagement rate | Authenticity score | Onboarding status |
|---|---|---|---|---|---|
| @dudamartins | Beleza sustentavel | 18,400 | 8.3% | 87 | qualified |
| @carolinafit | Fitness e bem-estar | 24,100 | 6.1% | 79 | qualified |
| @anafashionbr | Moda feminina | 31,200 | 4.7% | 72 | qualified |
| @pedrogeek | Tecnologia e games | 15,800 | 9.2% | 91 | qualified |
| @luanacook | Culinaria saudavel | 12,600 | 11.4% | 94 | qualified |
| @thiagoviagem | Viagens e lifestyle | 42,000 | 3.8% | 61 | qualified |
| @natybeauty | Beleza e skincare | 9,700 | 7.6% | 83 | qualified |
| @brunotech | Gadgets e inovacao | 20,500 | 5.3% | 76 | qualified |
| @marinasaude | Saude e nutricao | 8,200 | 10.1% | 88 | qualified |
| @jessicaarte | Arte e ilustracao | 6,400 | 13.2% | 95 | pending |

`@jessicaarte` has `onboarding_status = 'pending'` and no authenticity score computed. She is used for the US-10.4 demo (the analyzing screen).

**Brands (2 total)**

| Account name | Industry | Safety rules |
|---|---|---|
| Bella Natural Cosmeticos | Beleza sustentavel | prohibited_topic: "testes em animais"; prohibited_topic: "parabenos"; competitor_mention: "Natura Cosmeticos" |
| NovaTech Eletronicos | Tecnologia de consumo | restricted_language: "o melhor do mercado"; restricted_language: "garantia de vida util"; competitor_mention: "Samsung Brasil" |

**Agency (1 total)**

| Account name | Clients |
|---|---|
| Agencia Pulso Digital | Bella Natural Cosmeticos, NovaTech Eletronicos |

**Campaigns (2 total)**

**Campanha Verao Bella 2027** (brand: Bella Natural Cosmeticos, status: active)
Brief: "Lancamento de linha de protetor solar vegano, publico-alvo mulheres 18 a 30 anos, formato Reels 30 segundos, hashtag obrigatoria #BellaNatural, nao mencionar ingredientes quimicos, nao fazer comparacoes com concorrentes"
Shortlist: `status = 'ready'`, all entries `decision = 'approved'`

| Creator | Fit reason (pre-written, Portuguese) |
|---|---|
| @dudamartins | A taxa de engajamento de 8,3% de @dudamartins e seu nicho dedicado a beleza sustentavel estao diretamente alinhados com o publico-alvo de mulheres de 18 a 30 anos desta campanha de lancamento vegano. |
| @carolinafit | O publico feminino e ativo de @carolinafit (24.100 seguidores, 6,1% de engajamento) representa uma oportunidade de ampliar o alcance da campanha para mulheres que valorizam produtos saudaveis e sustentaveis. |
| @natybeauty | A especializacao de @natybeauty em beleza e skincare, com uma pontuacao de autenticidade de 83, oferece credibilidade natural para a recomendacao de um novo protetor solar vegano. |
| @marinasaude | A combinacao de saude e nutricao no conteudo de @marinasaude (10,1% de engajamento) ressoa com consumidoras que buscam produtos alinhados a um estilo de vida saudavel e consciente. |

**Lancamento NovaTech Pro** (brand: NovaTech Eletronicos, status: active)
Brief: "Apresentacao do novo smartphone NovaTech Pro, publico-alvo homens e mulheres de 20 a 35 anos interessados em tecnologia, formato feed + Stories, nao usar o termo 'o melhor do mercado', nao mencionar Samsung"
Shortlist: `status = 'ready'`, all entries `decision = 'approved'`

| Creator | Fit reason (pre-written, Portuguese) |
|---|---|
| @pedrogeek | Com 9,2% de engajamento e um nicho focado em tecnologia e games, @pedrogeek atinge exatamente o publico-alvo de entusiastas de tecnologia entre 20 e 35 anos desta campanha de lancamento. |
| @brunotech | O foco de @brunotech em gadgets e inovacao (5,3% de engajamento, 20.500 seguidores) garante relevancia direta para a audiencia de tecnologia da NovaTech Pro. |
| @thiagoviagem | O publico amplo de @thiagoviagem (42.000 seguidores) oferece alcance significativo, embora seu nicho de viagens tenha compatibilidade parcial com tecnologia de consumo. |

**Content submissions (3 total, for Campanha Verao Bella 2027)**

| Creator | Caption | Tier-1 | Tier-2 state | Safety check status |
|---|---|---|---|---|
| @dudamartins | "Amei esse protetor solar da @BellaNatural! Leve, vegano e cheiroso. #BellaNatural #VeganBeauty" | pass | pass | `passed`, `tier_reached = 'tier2'`, `ai_safety_reason` populated with a pre-written reason (e.g., "O conteudo nao apresenta violacoes semanticas das regras desta campanha.") |
| @natybeauty | "Teste em animais? Nunca mais! Essa linha da Bella Natural e 100% vegana #BellaNatural" | flagged (keyword: "teste em animais") | n/a | `flagged`, `tier_reached = 'tier1'`, in review queue |
| @carolinafit | "To amando o novo protetor da Bella, parece que cura qualquer dano solar -- ja virei fa! #BellaNatural" | pass | pending (not yet run) | `pending`, `tier_reached = null` |

The `@carolinafit` submission is seeded as tier-2 pending so the demo operator can trigger a live Claude tier-2 call during the walkthrough.

**Briefing Q&A thread (1 thread, for @carolinafit on Campanha Verao Bella 2027)**

Two pre-existing creator messages; zero AI replies:

| Message | Body |
|---|---|
| Message 1 (creator) | Posso mencionar que uso o produto no dia a dia ou precisa parecer uma primeira experiencia? |
| Message 2 (creator) | O Reels pode ter musica de fundo ou precisa ser so a minha voz? |

---

## 11. NFR Traceability

| NFR | Target | How E10 meets it |
|---|---|---|
| NFR-01 | Shortlist p95 <= 60 seconds for 100 creators | Fit reason calls run in parallel batches (default batch size 10, 10 seconds per call timeout). Estimated 30 seconds for 100 entries in 10 batches. Batch size is configurable. Partial failures (timeout per entry) do not delay the batch. See section 8. |
| NFR-03 | Safety verdict p95 <= 5 minutes | Tier-2 runs with a hard timeout of `AI_SAFETY_TIMEOUT_MS` (default 60 seconds), well inside the 5-minute window. Tier-2 is called only for ambiguous cases (~15% of submissions, per E4 architecture). The existing 10-minute outer timeout (ADR-0022) bounds the absolute worst case. |
| NFR-04 | Read p95 <= 500 ms; write p95 <= 1500 ms | No synchronous endpoint in this epic makes a Claude call. The briefing Q&A endpoint opens an SSE stream and delegates latency to the stream. The shortlist and safety queue GET endpoints are plain reads against indexed rows; the new columns are nullable and add no query complexity. |
| NFR-25 | Creator-facing interfaces from 360 px | US-10.4 (animated onboarding screen) is creator-facing. The frontend must comply with the 360 px constraint. The briefing Q&A stream endpoint is creator-facing; the streaming UI component must comply. |
| NFR-27 | Brazilian Portuguese primary locale | Every prompt template in section 5 begins with "Responda SEMPRE em Portugues Brasileiro". All seed data text in section 10 is in Brazilian Portuguese. The four step labels in US-10.4 are externalized keys. |
| NFR-29 | Matching and safety models replaceable | The Claude calls in both `RealMatchingEngineAdapter` and `RealContentSafetyAdapter` remain inside their respective adapter boundaries. No code outside `matching` module reads `fit_reason` from the matching-module table; it surfaces only through `GenerateShortlistEntry`. No code outside `brand-safety` module reads Claude's safety response directly; it surfaces only through `EvaluateResult` and then `safety_review_queue_item`. Swapping Claude for a different model is a change to `InferenceService`'s configuration (env var) with no code change. Swapping the entire reasoning strategy is a change inside the adapter only. |
| NFR-30 | 100% externalized configuration | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL_QA`, `ANTHROPIC_MODEL_FIT_REASON`, `ANTHROPIC_MODEL_SAFETY`, and all timeout/batch-size variables are environment variables. No value is hardcoded. See section 2.3. |
| NFR-32 | Structured logs with correlation ID, 30 days | Every Claude API call log entry carries the `correlationId` from the calling request. See section 2.5 for the full set of required log fields. The correlation ID is passed explicitly to both `completeText` and `streamText`. |
