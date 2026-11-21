# E10 -- AI Creator Demo

**Goal:** Make every AI integration point in Aurora visible and functional during a live walkthrough for advisors and investors, turning four existing stubs into working Claude-powered behaviors that a demo operator can trigger end-to-end without scripted workarounds.

**Personas:** Marina (brand media manager), Duda (nano creator)

**Journey phases:** Marina matching, Marina live campaign; Duda briefing and creation, Duda onboarding

**Strategic role:** E10 does not introduce new customer-facing capabilities beyond what the product already promises in E3, E4, E5, and E8. Its role is to wire the Claude API into four integration points those epics architected but left as stubs, and to seed a database state that lets a demo operator walk a coherent scenario from campaign creation to content safety check in one sitting. Every behavior this epic activates already has an adapter boundary, a data model, and acceptance criteria in the epic that owns it; E10's job is to bring those stubs to life and make the resulting experience legible during a walkthrough.

**Demo scenario this epic must support:** A brand creates a campaign and receives a shortlist where every creator entry includes a plain-language AI fit explanation. The brand approves the shortlist, a briefing is sent, and the creator asks a question about the brief. The AI answers in real time with a visible "thinking" state. The creator submits content that passes keyword checks but is semantically ambiguous; the AI performs a tier-2 semantic check and either clears it or routes it to the review queue with a plain-language reason. The onboarding flow for a new creator shows an animated step-by-step progress before revealing the computed score.

---

## Governing NFRs

E10 is not in Table 15 of the PRD because it post-dates the original story catalog. The NFRs below are selected directly from Table 14 on the basis of which requirements each story's changes are constrained by. They do not replace the governing NFRs of the epics that own the underlying features (E3, E4, E5, E8); they add to them for the work this epic performs inside those boundaries.

| NFR | Attribute | Target | Why it governs E10 |
|---|---|---|---|
| NFR-01 | Performance | Shortlist generation p95 ≤ 60 seconds for campaigns of up to 100 creators | US-10.2 adds Claude reasoning generation inside the same async shortlist job; fit reason text must not push shortlist generation over the existing 60-second budget |
| NFR-03 | Performance | Brand safety verdict p95 ≤ 5 minutes per submission | US-10.3 activates tier-2 inside the cascade that already commits to this target; Claude's tier-2 latency must be absorbed within the 5-minute window, not added on top of it |
| NFR-04 | Performance | Read p95 ≤ 500 ms; write p95 ≤ 1,500 ms | Applies to every synchronous endpoint and state-change action in this epic |
| NFR-25 | Usability | Creator-facing interfaces fully functional from 360 px viewport width | US-10.4's animated onboarding screen is creator-facing |
| NFR-27 | Usability | Brazilian Portuguese as the primary locale; all user-facing text externalized for translation | US-10.5 seed data must use Brazilian names and Portuguese-language content; AI-generated text in US-10.1, US-10.2, and US-10.3 must respond in Brazilian Portuguese |
| NFR-29 | Modifiability | Matching and safety models replaceable without touching campaign or payment code or a database migration | US-10.2 and US-10.3 activate implementations behind `MatchingEngineAdapter` and `ContentSafetyAdapter` respectively; the adapter boundaries must be respected and not leaked into surrounding modules |
| NFR-30 | Modifiability | 100% of environment-specific configuration supplied externally at deploy time | The Claude API key and model identifiers must never be hardcoded; they must be injected via environment variables |
| NFR-32 | Observability | Structured logs carrying a correlation identifier end to end, retained 30 days | Claude API calls made in US-10.1, US-10.2, and US-10.3 must carry the request's correlation ID in log entries; a prompt-to-response round trip must be traceable |

The eight platform-wide NFRs that govern every epic without appearing in any row (NFR-07, NFR-10, NFR-12, NFR-14, NFR-18, NFR-28, NFR-30, NFR-31) apply here without exception.

---

## US-10.1 -- Briefing Q&A Powered by Claude

**Persona:** Duda (nano creator)

**As** Duda, **I want** to ask a question about a briefing and receive a streamed answer from an AI that understands the full briefing, **so that** ambiguity is resolved instantly without waiting for the brand to reply manually.

**Priority:** Must (for the demo)

**Demo scenario role:** This is the mid-walkthrough beat where a live audience sees Aurora respond to a creator question in real time. The "thinking" animation makes the AI response legible as AI rather than a canned string; the streamed answer demonstrates a live model call, not a stub.

**Related functional requirements:** FR-38 (briefing Q&A thread, from E5), extended by this story to add AI-generated responses.

**Builds on E5's existing data model.** The `BRIEFING_QA_THREAD` and `BRIEFING_QA_MESSAGE` tables already exist per the E5 architecture. `BRIEFING_QA_MESSAGE.sender_type` currently accepts `'creator'` or `'brand'`. This story requires a third value -- see Open Questions for the two possible schema approaches and the product decision needed before build.

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 1 | Normal: creator asks a question and receives a streamed AI answer | Duda has an active opportunity on a campaign whose briefing has been issued (US-30, E5), and an open `BRIEFING_QA_THREAD` for that briefing exists | she submits a question on the thread | the UI immediately shows an AI "thinking" indicator; the system sends the question text plus the full briefing body (do's, don'ts, reference examples, deliverable spec, and deadline) to Claude as a single prompt; Claude's response streams back to the UI token-by-token until the full answer is received; the completed answer is stored in `BRIEFING_QA_MESSAGE` as a system-authored AI message on the same thread; the "thinking" indicator disappears once the stream closes. |
| 2 | Hard: the briefing body is long and the question requires referencing a specific detail | The briefing contains multiple deliverable requirements (aspect ratio, mandatory hashtags, caption length cap) and Duda's question asks specifically about one of them | she submits the question | Claude's answer references the specific detail from the briefing relevant to the question, not a generic response about the campaign as a whole. The full briefing body, not a summary of it, is included in the prompt so Claude has the complete context. |
| 3 | Failure: the Claude API call fails or times out | The Claude API is unreachable, returns an error status, or does not respond within the timeout configured for this endpoint | Duda submits a question | the UI clears the "thinking" indicator and shows Duda a plain message stating that an automatic answer is not available right now and her question remains open for a human reply. The question is stored in `BRIEFING_QA_MESSAGE` as a creator message regardless of whether the AI responded; it is never silently lost because the AI call failed. No partial or error message from Claude is stored as an AI answer. |
| 4 | Failure: Duda has no active opportunity on the campaign | Duda's opportunity for the campaign was declined or has since expired | she attempts to submit a question on the briefing thread | the system does not send anything to Claude and does not create a new message; the access check that guards the thread (US-30 scenario 3, E5) already blocks this before any AI call is attempted. This scenario confirms that the AI call path does not introduce a new access bypass. |

**Governing NFRs:** NFR-04, NFR-27, NFR-30, NFR-32

**Schema extension required:** `BRIEFING_QA_MESSAGE.sender_type` must accommodate AI-authored messages. See Open Questions item 1.

**Integration note:** This story calls Claude from within the `content-workflow` module (which owns the Q&A thread per E5) or from a new thin `ai-features` module that the `content-workflow` module delegates to. The choice is an architecture decision; this document does not prescribe it. What is prescribed: the Claude API key is injected via an environment variable (NFR-30), the call carries the request's correlation ID in its log entry (NFR-32), and the prompt includes the full briefing body assembled from the `BRIEFING` row, not a cached or summarized form of it.

---

## US-10.2 -- Creator Shortlist with AI Fit Reasoning

**Persona:** Marina (brand media manager)

**As** Marina, **I want** every creator on a shortlist to include a one-to-two sentence plain-language explanation of why they fit this specific campaign, **so that** I can make an approval decision based on reasoning rather than a numeric score alone.

**Priority:** Must (for the demo)

**Demo scenario role:** This is the moment in the walkthrough where the shortlist appears and the audience sees that Aurora is not just ranking by a hidden score. Each creator card shows a sentence like "Duda's 8.3% engagement rate and beauty-focused content align directly with this campaign's target audience of 18-24 year-old women." The reasoning makes the AI's judgment transparent and auditable.

**Related functional requirements:** FR-25 (shortlist ranked by fit), FR-26 (campaign attributes stated per creator), from E3.

**Builds on E3's existing data model.** `CAMPAIGN_SHORTLIST_ENTRY` already has `fit_score` (numeric) and `matched_attributes` (jsonb). This story adds a `fit_reason` text column. See Open Questions item 2 for the additive migration boundary.

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 1 | Normal: each shortlist entry includes a fit reason when the shortlist resolves | A campaign shortlist is requested for a campaign with a defined brief, audience, and deliverable format, and there are eligible creators in the pool | the async shortlist job completes (`CAMPAIGN_SHORTLIST.status` transitions to `'ready'`) | every `CAMPAIGN_SHORTLIST_ENTRY` row produced by the real matching engine includes a non-null `fit_reason` text field containing one to two sentences in Brazilian Portuguese that explain, in plain language, why this specific creator fits this specific campaign. The explanation references at least one concrete signal (such as engagement rate, niche, or audience demographic) rather than restating the creator's name or the campaign's title. |
| 2 | Hard: fit reason reflects the campaign's specific brief, not a generic creator summary | A campaign targets women aged 18-24 with an interest in sustainable beauty products, and two creators have similar engagement rates but different niches -- one beauty, one fitness | both appear on the shortlist | each creator's `fit_reason` distinguishes them relative to the campaign's specific targeting attributes. The beauty-niche creator's reason references audience alignment; the fitness-niche creator's reason (if included) honestly reflects the partial match. Claude is given the full campaign brief and the full creator profile as prompt inputs, not a pre-summarized version of either. |
| 3 | Hard: fit reason generation must not push shortlist completion over NFR-01's budget | A campaign shortlist covers 100 creators (the NFR-01 target size) | the shortlist job runs | the entire job -- scoring, ranking, fit reason generation for every entry, and writing all results -- completes within the p95 ≤ 60-second window established for shortlist generation (NFR-01). Fit reason generation is parallelized or batched to stay within this budget; it is not a sequential, one-at-a-time blocking loop over all 100 entries. |
| 4 | Failure: Claude call fails for one or more entries during shortlist generation | The Claude API call for a subset of creators fails mid-job (timeout, rate limit, or error) | the shortlist job otherwise completes | entries whose fit reason generation failed are written with `fit_reason = null` and a flag indicating the reason is unavailable; the shortlist as a whole is not failed or held back because of partial reasoning unavailability. Marina sees those entries with their numeric `fit_score` and `matched_attributes` but without a text reason, and can still approve or reject them. The shortlist status becomes `'ready'`, not `'failed'`, when scoring is complete regardless of partial reasoning gaps. |

**Governing NFRs:** NFR-01, NFR-04, NFR-27, NFR-29, NFR-30, NFR-32

**Schema extension required:** `CAMPAIGN_SHORTLIST_ENTRY` needs a new nullable `fit_reason text` column and a nullable `fit_reason_unavailable boolean` column. This is an additive change to E3's data model; the E3 adapter boundary (`MatchingEngineAdapter`) must be respected -- the calling code in `campaign` does not change, only the `matching` module's implementation of `generateShortlist`. See Open Questions item 2.

**Integration note:** The `RealMatchingEngineAdapter` currently returns shortlist entries with `fit_score` but no `fit_reason`. This story extends `RealMatchingEngineAdapter` to call Claude for each entry (or in parallel batches) after scoring is complete, before writing results. The adapter interface contract (`MatchingEngineAdapter`) must be updated to include `fit_reason` in the returned entry shape if it does not already do so. This is an interface change inside the `matching` module boundary; `campaign` and payment code must not read `fit_reason` directly from any matching-module table.

---

## US-10.3 -- Brand Safety Tier-2 Semantic Check with Claude

**Persona:** Marina (brand media manager)

**As** Marina, **I want** content that passes keyword checks but raises a semantic concern to be evaluated by an AI against my campaign's safety rules, **so that** the review queue only receives items that genuinely need a human decision, with a plain-language explanation of why.

**Priority:** Must (for the demo)

**Demo scenario role:** This is the safety beat at the end of the walkthrough. A submission with no banned keywords reaches tier-2. Claude evaluates it against the campaign ruleset and returns either a clear (bypassing the queue) or a flagged verdict with a reason the brand reviewer can read in plain Portuguese. The audience sees that Aurora's safety layer is semantic, not just lexical.

**Related functional requirements:** FR-32 (message-level brand safety check), FR-34 (flagged content routed to human review queue with specific rule cited), FR-33 (content cannot be published without passing the check), from E4.

**Builds on E4's existing two-tier cascade architecture.** The `ContentSafetyAdapter` already defines a tier-1 (deterministic keyword/regex, implemented) and a tier-2 (semantic analysis, stub). The `SAFETY_CHECK`, `SAFETY_RULE_TRIGGER`, and `SAFETY_REVIEW_QUEUE_ITEM` tables already exist. This story activates the tier-2 stub with a real Claude call. `SAFETY_REVIEW_QUEUE_ITEM` currently has no `ai_safety_reason` column; this story adds one. See Open Questions item 3 for the exact column placement decision.

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 1 | Normal: tier-2 evaluates content that cleared tier-1 and returns a pass | A content submission's caption text contains no keyword or regex matches from the campaign ruleset (tier-1 passes with no triggers), and the content is semantically consistent with the campaign's rules | the tier-2 check runs | Claude returns a "pass" verdict; the `SAFETY_CHECK` resolves with `status = 'passed'` and `tier_reached = 'tier2'`; no `SAFETY_REVIEW_QUEUE_ITEM` row is created; the content is eligible for the brand approval gate (US-19, E5) without entering the human review queue. |
| 2 | Normal: tier-2 flags content that cleared tier-1 and routes it with a reason | A submission passes all keyword/regex rules but its text contains a semantically prohibited topic (for example, a health claim that does not use any explicitly banned keyword) | tier-2 runs | Claude returns a "flagged" verdict and a one-to-three sentence plain-language `safety_reason` in Brazilian Portuguese explaining what it found and which of the campaign's rules it implicates. A `SAFETY_REVIEW_QUEUE_ITEM` row is created with `reason_category = 'rule_violation'`; the `safety_reason` text is stored and visible in the review queue so Marina's reviewer reads Claude's explanation alongside the content. |
| 3 | Hard: the safety reason names the specific rule and content channel, not just a generic flag | The campaign ruleset has three distinct rules (a prohibited topic, a restricted language pattern, and a competitor mention), and the submitted caption semantically implicates one of them | tier-2 flags the content | the `safety_reason` text names which of the three rules was implicated and in which channel (caption, on-screen text, or audio transcript) it was detected, rather than stating only that the content was flagged. This is consistent with US-16 scenario 2 and US-17 scenario 2 in E4's stories, which require the specific rule and channel to be cited. |
| 4 | Failure: Claude returns an error or times out during tier-2 | The Claude API is unreachable, returns an error, or does not respond before the tier-2 timeout threshold | tier-2 fails | the `SAFETY_CHECK` resolves with `status = 'check_unavailable'` and `tier_reached = 'tier2'`; a `SAFETY_REVIEW_QUEUE_ITEM` row is created with `reason_category = 'check_unavailable'`, consistent with how the existing E4 architecture already handles timeout at the check level (ADR-0022). The `safety_reason` column is left null for `check_unavailable` items; the reason_category communicates that the check itself failed, not that content violated a rule. The overall p95 ≤ 5-minute budget (NFR-03) is maintained by applying a hard timeout to the Claude call before the outer check timeout is reached. |
| 5 | Failure: tier-2 is called but the campaign has no ruleset | A content submission is checked for a campaign whose account has never saved any safety rules (no `SAFETY_RULESET` row exists) | tier-2 is invoked | the system does not send a prompt with an empty ruleset to Claude. The check resolves to `status = 'passed'` without a tier-2 call, identical to the behavior tier-1 already specifies when no rules are defined. Claude is not called with a vacuous safety context. |

**Governing NFRs:** NFR-03, NFR-04, NFR-27, NFR-29, NFR-30, NFR-32

**Schema extension required:** `SAFETY_REVIEW_QUEUE_ITEM` needs a new nullable `ai_safety_reason text` column to hold Claude's plain-language explanation. This is an additive change. See Open Questions item 3 for which table is the right owner of this field (it could alternatively live on `SAFETY_CHECK` rather than on the queue item).

**Integration note:** The `ContentSafetyAdapter` interface's tier-2 method must return both a verdict (`pass | flagged`) and a nullable `safety_reason` string. The adapter boundary (NFR-29) means no code outside the `brand-safety` module reads Claude's response directly; the reason surfaces only through `SAFETY_REVIEW_QUEUE_ITEM`'s new column. Claude is given the submission text (caption, on-screen text, and audio transcript, whichever are populated) and the effective campaign ruleset (the merged brand-plus-campaign-override set of active rules), not a raw dump of `SAFETY_RULE` rows. The exact prompt structure is an implementation decision for the adapter; this document does not prescribe it.

---

## US-10.4 -- Animated Creator Onboarding "Analyzing" Screen

**Persona:** Duda (nano creator)

**As** Duda, **I want** the onboarding screen that runs while my profile is being analyzed to show me exactly what is being computed -- step by step -- and then reveal my actual score with a visual breakdown, **so that** I know what Aurora is evaluating and trust the result at the end.

**Priority:** Must (for the demo)

**Demo scenario role:** This is the opening beat of the creator side of the walkthrough. A new creator completes social account linking; the analyzing screen runs for a few seconds with animated steps, then reveals a score. The audience sees that Aurora's authenticity scoring is real computation, not a black box. The step labels make the signal categories legible without requiring a technical explanation.

**Related functional requirements:** FR-09 (compute audience metrics), FR-10 (compute authenticity score), FR-11 (inform creator of qualification status at the end of onboarding), from E8.

**Builds on the existing stub.** The route `/creator-portal/onboarding/analyzing` already exists and shows a static screen. This story replaces the static content with the animated sequence described below. The underlying metrics computation (authenticity scoring, engagement rate, audience composition) is already a stub returning synthetic scores from `AuthenticityScoringAdapter`; this story changes the visual presentation of that computation, not the computation itself. See Open Questions item 4 for what happens if the adapter is wired to a live model.

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 1 | Normal: the four animated steps appear sequentially and resolve to the score | Duda has completed social account linking and arrived at `/creator-portal/onboarding/analyzing` | the screen loads | four labeled steps appear in sequence, each after a brief programmatic pause: (1) "Verificando autenticidade", (2) "Calculando taxa de engajamento", (3) "Avaliando composicao do publico", (4) "Gerando sua pontuacao". Each step has a visual in-progress indicator that resolves to a completed state before the next step begins. After the fourth step resolves, the screen transitions to the score reveal. |
| 2 | Normal: the score reveal shows the computed value with a signal breakdown | The four steps have completed and the authenticity score is available from the adapter | the transition to score reveal occurs | the screen shows the creator's computed score (the numeric value from the adapter, 0-100) alongside a visual breakdown that labels each of the four signal categories used to compute it, with a relative contribution indicator per category. The score displayed is the value the adapter returned, not a hardcoded placeholder. |
| 3 | Hard: the step sequence completes correctly even when the adapter result is fast | The underlying adapter returns a result synchronously or near-instantaneously (as the current stub does) | the analyzing screen runs | the step sequence still plays out at its defined pace rather than immediately jumping to the score reveal. The animation timing is decoupled from actual computation time: the steps exist to communicate what Aurora measures, not to represent a live progress indicator tied to real computation latency. |
| 4 | Failure: the adapter returns a failure or the score is unavailable | The authenticity scoring adapter returns an error or returns a null score | the fourth step resolves | the screen does not show a broken score widget or a zero. It transitions to a plain state that tells Duda her analysis is taking longer than expected and that she will be notified when it is ready. The step animation itself still completes normally so she is not left on a frozen screen. |
| 5 | Failure: the creator navigates away and returns mid-analysis | Duda navigates away from the analyzing screen before the steps complete, then navigates back | she returns | the screen either resumes from the correct step based on the actual adapter state or restarts the sequence cleanly. It never shows a partly-animated screen with inconsistent step states frozen from the previous visit. |

**Governing NFRs:** NFR-04, NFR-25 (360 px viewport), NFR-27 (Brazilian Portuguese step labels)

**Frontend note:** Step label strings must be externalized for translation per NFR-27, not hardcoded in the component. The four strings listed above are the demo-ready canonical forms in Brazilian Portuguese; they are inputs to the translation table, not inline constants.

---

## US-10.5 -- Demo Seed Data

**Persona:** Internal (demo operator)

**As** a demo operator, **I want** a single CLI command to populate the database with a coherent, realistic dataset that covers every AI touchpoint, **so that** I can walk the full demo scenario from a clean state without manually entering data before each session.**

**Priority:** Must (for the demo)

**Demo scenario role:** This story is the prerequisite for every other story in this epic. The demo scenario has no ambiguity about what data to expect -- every AI touchpoint fires against specific, named, realistic records rather than improvised placeholder entries. Running `npm run seed:demo` before the walkthrough is the full setup ritual.

**Related functional requirements:** None in the original PRD (seed data is out of scope for the product requirements). This story is scoped to demo infrastructure only and must not affect any behavior or data in production or staging environments.

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 1 | Normal: the command completes and all required records exist | The database is reachable and in a clean or partial state | the operator runs `npm run seed:demo` | the command completes without error and the database contains exactly the records specified below. Running the command a second time against a database that already has the seed data either skips existing records cleanly (idempotent) or fails with a clear error message stating that seed data already exists, rather than creating duplicates. |
| 2 | Hard: the seed covers all AI touchpoints with plausible variation across creators | The command has run successfully | the demo operator opens the brand portal | (a) the two campaigns each have a shortlist with entries carrying non-null `fit_reason` text; (b) the Q&A thread contains two existing creator messages and no existing AI replies, so the AI response can be triggered live during the demo; (c) the three content submissions have distinct safety check states that demonstrate tier-1 pass, tier-1 flag, and tier-2 pending states; (d) the onboarding analyzing screen can be reached via the creator who has not yet completed analysis. |
| 3 | Failure: the command is run against a production or staging environment | The database connection string resolves to any non-local, non-demo environment (detected by environment variable) | the operator runs `npm run seed:demo` | the command refuses to execute, logs an error naming the environment it detected, and exits with a non-zero code. No records are written. This guard must be explicit, not implied by convention. |

**Required seed records:**

**Creators (10 total, varied niches and scores)**

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
| @jessicaarte | Arte e ilustracao | 6,400 | 13.2% | 95 | pending (not yet completed analysis -- used for US-10.4 demo) |

**Brands (2 total)**

| Account name | Industry | Brand profile notes |
|---|---|---|
| Bella Natural Cosmeticos | Beleza sustentavel | Safety rules: prohibited topics = "testes em animais", "parabenos"; competitor = "Natura Cosmeticos" |
| NovaTech Eletronicos | Tecnologia de consumo | Safety rules: restricted language = "o melhor do mercado", "garantia de vida util"; competitor = "Samsung Brasil" |

**Agency (1 total)**

| Account name | Clients |
|---|---|
| Agencia Pulso Digital | Bella Natural Cosmeticos, NovaTech Eletronicos |

**Campaigns (2 total, one per brand)**

| Campaign | Brand | Status | Brief summary | Pool creators |
|---|---|---|---|---|
| Campanha Verao Bella 2027 | Bella Natural Cosmeticos | active | Lancamento de linha de protetor solar vegano, publico-alvo mulheres 18-30, formato Reels 30s, hashtag obrigatoria #BellaNatural | @dudamartins, @carolinafit, @natybeauty, @marinasaude (all approved on shortlist) |
| Lancamento NovaTech Pro | NovaTech Eletronicos | active | Apresentacao do novo smartphone NovaTech Pro, publico-alvo homens e mulheres 20-35 interessados em tecnologia, formato feed + Stories | @pedrogeek, @brunotech, @thiagoviagem (all approved on shortlist) |

Both campaigns must have a `CAMPAIGN_SHORTLIST` with `status = 'ready'` and all entries in state `decision = 'approved'`. Every shortlist entry must have a non-null `fit_reason` populated with a realistic Portuguese sentence matching the creator's profile to the campaign brief. The `fit_reason` values in seed data are pre-written strings, not generated by Claude at seed time; they demonstrate the final state Claude would produce.

**Content submissions (3 total, for Campanha Verao Bella 2027)**

| Creator | Caption text | Tier-1 result | Tier-2 state | Safety check status |
|---|---|---|---|---|
| @dudamartins | "Amei esse protetor solar da @BellaNatural! Leve, vegano e cheiroso. #BellaNatural #VeganBeauty" | pass (no keyword match) | pass | `passed`, `tier_reached = 'tier2'`, `fit_reason` populated |
| @natybeauty | "Teste em animais? Nunca mais! Essa linha da Bella Natural e 100% vegana #BellaNatural" | flagged (keyword: "teste em animais") | n/a | `flagged`, `tier_reached = 'tier1'`, in review queue |
| @carolinafit | "To amando o novo protetor da Bella, parece que cura qualquer dano solar -- ja virei fa! #BellaNatural" | pass (no keyword match) | pending | `pending`, `tier_reached = null` (tier-2 has not yet resolved -- used to trigger live Claude call during demo) |

**Briefing Q&A thread (1 thread, for @carolinafit on Campanha Verao Bella 2027)**

The thread must contain exactly two existing creator messages and zero AI replies, so the demo operator can trigger US-10.1 live:

| Message 1 (creator) | "Posso mencionar que uso o produto no dia a dia ou precisa parecer uma primeira experiencia?" |
|---|---|
| Message 2 (creator) | "O Reels pode ter musica de fundo ou precisa ser so a minha voz?" |

No AI messages exist in the thread at seed time. Both questions are genuinely answerable from the briefing body, so Claude can generate a useful response live.

**Governing NFRs:** NFR-27 (all seed content in Brazilian Portuguese), NFR-30 (no production environment write guard hardcoded -- the check reads an environment variable)

**Open Questions for this story:**

The seed command must decide what to do when it detects existing seed data. Two options are plausible -- idempotent upsert (run-safe, complex) or fail-fast with a clear message (simpler, requires a manual teardown step). This document does not choose; the demo operator's workflow should inform the decision before build.

---

## Open Questions

1. **`BRIEFING_QA_MESSAGE.sender_type` schema for AI messages (US-10.1).** The E5 architecture defines `sender_type` as `'creator' | 'brand'`. AI-generated answers need a third representation. Two options: (a) add `'ai'` as a new enum value -- clean but requires a schema migration and an E5 architecture update; (b) store AI messages with `sender_type = 'brand'` and a new boolean `is_ai_generated` column -- avoids changing an enum but couples AI provenance to the brand identity. The choice has display implications (the UI must distinguish AI answers from human brand replies in the Q&A thread). A product and architecture decision is needed before build.

2. **`CAMPAIGN_SHORTLIST_ENTRY.fit_reason` migration ownership (US-10.2).** The E3 architecture document owns the `campaign_shortlist_entry` table definition. Adding `fit_reason text` and `fit_reason_unavailable boolean` requires a migration in the E3 module. This epic does not own E3's schema, so the migration must be explicitly handed off to whoever is responsible for the E3 codebase, or E10 must be treated as adding the column in a new migration file that E10 owns. The boundary needs to be agreed before build to avoid conflicting migration files.

3. **`ai_safety_reason` column placement (US-10.3).** The plain-language reason Claude produces for a tier-2 check could live on `SAFETY_REVIEW_QUEUE_ITEM` (visible at the point of human review -- most useful for the reviewer) or on `SAFETY_CHECK` (tied to the check itself, persisted even if no queue item is created for a tier-2 pass). For the demo, only flagged items have a queue item, so placing the column on `SAFETY_REVIEW_QUEUE_ITEM` is sufficient. However, it means the reason for a tier-2 pass is not stored anywhere persistently. Whether that matters for audit purposes (NFR-17) is a product decision. This document attaches the column to `SAFETY_REVIEW_QUEUE_ITEM` as the minimal-change option and records the alternative as open.

4. **Relationship between US-10.4's animated screen and a future live `AuthenticityScoringAdapter` (US-10.4).** The story explicitly scopes US-10.4 to visual presentation of the existing stub's output. If E10 also wires `AuthenticityScoringAdapter` to a live model (not stated in the epic goal), the step animation timing would need to reflect real computation latency rather than a fixed programmatic delay. This epic does not activate the authenticity scoring adapter; that scope addition would need a separate story. The open question is whether the demo requires a live authenticity score or whether the existing synthetic scores from the stub are sufficient for the walkthrough.

5. **Language of Claude responses (US-10.1, US-10.2, US-10.3).** NFR-27 requires Brazilian Portuguese as the primary locale, but the prompts sent to Claude must explicitly instruct it to respond in Brazilian Portuguese. If a creator asks a briefing question in English, should Claude answer in Portuguese, or mirror the question's language? This document assumes Portuguese always, consistent with NFR-27, but the prompt instruction needed to enforce this is an implementation detail the architect must confirm before build.

6. **Claude model selection and cost (all AI stories).** The user brief identifies Claude as the target model but does not specify which variant (Haiku, Sonnet, Opus) for each use case. E4's architecture mentions a "Claude Haiku screen, Claude Opus escalation" pattern for the two-tier cascade, but US-10.1 (Q&A streaming) and US-10.2 (fit reasons) have no model specified. Model choice directly affects both latency and cost (NFR-33, NFR-34). Model identifiers must be injected via environment variables (NFR-30), so the choice can be changed without a code deploy, but an initial default must be chosen before the first demo run.

7. **Demo seed data teardown (US-10.5).** The stories document specifies that `npm run seed:demo` populates data but does not specify a companion `npm run seed:demo:teardown` or equivalent reset command. If the demo is run multiple times, the operator needs a reliable way to restore the seed state (particularly the pending Q&A thread and the pending tier-2 content submission, both of which change state during the walkthrough). Whether teardown is a second CLI command, a flag on the same command, or a manual database reset is a workflow decision needed before the first full demo rehearsal.

8. **Fit reason for agency-added shortlist entries (US-10.2, FR-29).** `CAMPAIGN_SHORTLIST_ENTRY.origin = 'agency_added'` entries were added manually by an agency, not scored by the matching engine. These entries have null `fit_score` and null `matched_attributes`. It is unclear whether Claude should generate a `fit_reason` for agency-added entries (which would require a different prompt, since there is no algorithmic score to explain), or whether `fit_reason` should remain null for them. This document does not specify behavior for agency-added entries in US-10.2 and records it as open.
