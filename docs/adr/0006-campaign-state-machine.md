# ADR-0006: Explicit Campaign State Machine Enforced in the Application Layer

**Status:** Proposed
**Date:** 2026-10-05
**Epic:** E2 -- Campaign Planning and Pool Buying
**Governs:** US-05, US-06, US-07, US-09, FR-16, FR-17, FR-20, FR-21

## Context

FR-20 requires a campaign lifecycle with exactly seven states (`draft`, `quoted`, `confirmed`, `active`, `paused`, `completed`, `cancelled`) and "only defined transitions" between them. US-09 scenario 3 requires that an invalid transition (e.g., pausing a `completed` campaign) is blocked, explained, and leaves the campaign and all creator content untouched.

Two implementation options were considered:

- **A `state` string column with ad hoc checks scattered across each endpoint handler.** Each action (pause, resume, cancel, confirm) independently checks "is the current state valid for this action?" inline. Fast to write initially, but the set of valid transitions is implicit, duplicated across handlers, and easy to get subtly wrong as more transitions are added (e.g., forgetting that `quoted -> draft` must happen automatically on edit, per FR-17's "fresh quote" rule).

- **A single state-machine service with an explicit transition table, consulted by every handler, backed by an append-only transition log table.** The valid transition set lives in one place (section 2.6 of the architecture doc). Every handler calls `assertTransition(campaign, toState)` before mutating anything. Every successful transition writes one row to `campaign_state_transition`, which doubles as the audit trail US-09 scenario 2 needs ("without losing any submitted drafts or history") and as the mechanism for proving a blocked transition left the campaign state unchanged.

## Decision

Campaign state transitions are enforced by a single `CampaignStateMachine` service with an explicit, centrally defined transition table (documented in architecture section 2.6), consulted before any state-changing handler mutates the campaign row. Every successful transition writes an append-only row to `campaign_state_transition`, recording `from_state`, `to_state`, the acting user (or null for system-triggered transitions like `confirmed -> active` on launch date), and an optional reason (used for pause/cancel).

Invalid transition attempts are rejected with 400 `INVALID_STATE_TRANSITION` before any other side effect runs (no partial pause, no partial cancellation), and the rejection itself is not written to the transition log (only successful transitions are), keeping that log a clean history rather than an error log.

## Consequences

**What Aurora gains:**
- One place to reason about "what can happen from this state," which is what backend-dev needs to implement every lifecycle endpoint consistently and what a reviewer needs to verify FR-20's "only defined transitions" claim is actually true in code, not just in documentation.
- A reusable audit trail that satisfies US-09 scenario 2's "without losing any submitted drafts or history" requirement directly: pausing and resuming never delete or mutate pool members or drafts, they only add transition rows, so nothing is lost by construction.
- Consistent error messaging across all lifecycle endpoints (same error code, same shape), which is what frontend-dev needs to render one reusable "this action is not available right now" component instead of five bespoke ones.

**What Aurora gives up:**
- A small amount of upfront design work centralizing the transition table versus just writing inline checks per handler. This cost is paid once and amortizes across six lifecycle endpoints.

**Risks:**
- If a future epic (e.g., E5's content workflow) needs to trigger a campaign state transition itself (not just react to one via an event), it must go through the same `CampaignStateMachine` service rather than writing to the `state` column directly, or the single-source-of-truth property breaks. This is a discipline risk, not a design flaw, and is called out here so it is not reintroduced accidentally.
