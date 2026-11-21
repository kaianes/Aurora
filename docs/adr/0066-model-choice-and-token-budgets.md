# ADR-0066: Claude Model Choice and Token Budgets for E10

**Status:** Proposed
**Date:** 2026-11-16
**Epic:** E10 -- AI Creator Demo
**Governs:** NFR-01, NFR-03, NFR-04, NFR-30, NFR-33
**Related:** ADR-0065 (InferenceModule), ADR-0067 (SSE streaming)

## Context

E10 activates Claude calls at three integration points: briefing Q&A (streaming), shortlist fit reasoning (batch), and brand safety tier-2 (single-shot JSON). Each has different latency requirements, output length requirements, and cost implications. The E4 architecture document mentioned "Claude Haiku screen, Claude Opus escalation" as a possible two-tier pattern, but this was an illustrative reference at the time of writing, not a binding decision. No ADR has ever committed to a specific Claude model for any use case.

The stories document (open question 6) names this as a pending decision. NFR-30 requires that model identifiers are injected via environment variables rather than hardcoded, so the choice made here is an operational default, not a permanent constraint. Any model can be substituted at deploy time without a code change.

**Constraints from the governing NFRs:**

- NFR-01: Shortlist p95 <= 60 seconds for 100 creators. Fit reason generation runs inside this window.
- NFR-03: Safety verdict p95 <= 5 minutes. Tier-2 runs inside this window.
- NFR-04: Interactive operations (read p95 <= 500 ms, write p95 <= 1500 ms). The briefing Q&A endpoint is interactive; it must start streaming before the HTTP timeout. Claude's time-to-first-token must be short enough that the browser does not time out before the stream starts.
- NFR-33: Infrastructure cost per campaign tracked from first campaign onward, targeting eventual trend toward <= 3% of campaign gross value.

**Three model options were evaluated:**

**claude-haiku-4-5 / claude-haiku-3-5**: Fastest and cheapest. The lightest model family available from Anthropic.

For a demo product at pilot scale (a handful of campaigns, dozens of shortlist generations, a few safety checks per demo session), cost is not the primary constraint. Haiku's output quality is sufficient for simple 1-2 sentence fit reasons, but its ability to reason about nuanced brand safety rules (specifically, the semantic detection of implied health claims without exact keyword matches, as in the `@carolinafit` demo scenario) is less reliable than Sonnet's.

**claude-sonnet-4-5**: Mid-tier capability and cost. The model named in the user brief as the target. Established quality for reasoning tasks. Latency is well within the NFR-01 and NFR-03 budgets for all three use cases at the token budgets this epic requires.

**claude-opus-4-5**: Highest capability, highest cost, highest latency. The fit reason generation scenario (100 creators, 10 parallel calls) with Opus latencies would risk the NFR-01 budget even at small batch sizes. For the demo use cases -- 1-2 sentence fit reasons, structured JSON safety verdicts, brief Q&A answers -- Opus capability is unnecessary.

**Token budget analysis:**

For fit reasoning at 100 creators with batch size 10:
- Each call: ~400 input tokens (campaign brief + creator profile), 128 output tokens max
- claude-sonnet-4-5 at 128 output tokens: approximately 1-2 seconds per call
- 10 parallel calls per batch = ~2 seconds per batch
- 10 batches = ~20 seconds for all fit reasons
- Total shortlist job budget: scoring (5-10s) + fit reasons (20s) + writes (5s) = ~35s, inside the 60s NFR-01 budget with margin

For briefing Q&A streaming:
- Input: ~1500 tokens (full briefing + question)
- Output: 1024 tokens max
- claude-sonnet-4-5 time-to-first-token: approximately 1-3 seconds
- This is fast enough for a visible streaming experience that does not feel frozen

For brand safety tier-2:
- Input: ~1000 tokens (content channels + ruleset)
- Output: 512 tokens max (structured JSON with reason)
- Expected duration: 3-10 seconds
- Well inside the 5-minute NFR-03 budget and the 60-second `AI_SAFETY_TIMEOUT_MS` default

## Decision

**Use `claude-sonnet-4-5` as the default model for all three E10 use cases.**

This is a single consistent choice rather than a per-use-case model matrix. The rationale for uniformity at the pilot stage: the latency and cost differences between model variants are not the binding constraint at pilot scale (a handful of campaigns and demo sessions), and a uniform model simplifies the operational mental model (one model to monitor, one to rotate, one to understand the capabilities of). When Aurora has real production volume, differentiated model choices become worth the operational complexity.

**Token budgets:**

| Use case | Max input tokens (approximate) | Max output tokens |
|---|---|---|
| Briefing Q&A | 3000 (conservative ceiling; full briefing body can be long) | 1024 |
| Fit reasoning (per entry) | 600 | 128 |
| Brand safety tier-2 | 2000 (content + full ruleset) | 512 |

These are `max_tokens` values passed to the Claude API. They are not approximate; they are the hard ceiling the API enforces. Backend-dev must pass these values directly (do not let the caller specify arbitrary token limits).

**Environment variables and defaults:**

| Variable | Default |
|---|---|
| `ANTHROPIC_MODEL_QA` | `claude-sonnet-4-5` |
| `ANTHROPIC_MODEL_FIT_REASON` | `claude-sonnet-4-5` |
| `ANTHROPIC_MODEL_SAFETY` | `claude-sonnet-4-5` |

These are read by the respective calling module (`content-workflow`, `matching`, `brand-safety`) via `ConfigService`, not by `InferenceService` itself. Each module passes the resolved model name to `InferenceService.completeText()` or `InferenceService.streamText()`. This keeps model selection as a responsibility of the calling module's configuration, not of the infrastructure wrapper.

**Token budgets are constants in each calling module, not environment variables.** They are not expected to change without a code review. If they need to change, that is a code change, not an operational config change. This is different from model names, which may need to change rapidly as new Claude variants are released.

## Consequences

**What Aurora gains:**
- A single default model for all three use cases simplifies demo operations, cost monitoring, and error correlation. If Claude behavior is unexpected during a demo walkthrough, there is one model to investigate.
- The pilot-scale latency and cost estimates in this ADR are well inside all governing NFRs with the chosen model.
- Model names are environment variables (NFR-30), so a production deployment can substitute a different model for any use case without touching code.

**What Aurora gives up:**
- Haiku would be cheaper per call for fit reasoning (100 short calls per shortlist). At pilot scale this difference is immaterial; at scale it could matter. This ADR records the tradeoff explicitly so a future operator can substitute `ANTHROPIC_MODEL_FIT_REASON=claude-haiku-4-5` if cost becomes a concern.
- Opus would produce higher-quality brand safety verdicts for edge cases. The demo scenario's tier-2 test case (an implied health claim without keyword matches) is well within Sonnet's reasoning capability. This ADR records that if production safety cases prove Sonnet's reasoning insufficient, `ANTHROPIC_MODEL_SAFETY=claude-opus-4-5` is an operational configuration change, not a code change.
- By not differentiating model choices per use case at the pilot stage, Aurora defers the complexity of a per-use-case model matrix. When real production volume provides quality and cost data, revisiting this ADR with per-use-case choices is the correct next step.
