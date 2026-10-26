# ADR-0039: Invoice Generation Is an Explicit, Precondition-Gated Action; FR-19 Adjustments Are Itemized Line Items on the Same Document

**Status:** Proposed
**Date:** 2026-10-21
**Epic:** E6 -- Payments and Financial Transparency
**Governs:** US-20, US-42, FR-48, FR-49

## Context

FR-48 requires "a single consolidated invoice to the buyer per campaign, covering the entire creator pool." PRD open question 7 states plainly that "the PRD does not say whether an invoice is issued once at campaign completion, periodically during a long-running campaign, or on some other trigger tied to the campaign lifecycle states defined in FR-20." US-20 scenario 3 is the one concrete signal available: "someone attempts to trigger invoice generation for a campaign before its billable pool state is settled... the system refuses to issue the invoice at that point, states why" -- this wording describes an *attempted*, caller-initiated action, not a scheduled or lifecycle-automatic one, which is the strongest hint this document has for resolving the open timing question. US-20 scenario 2 separately requires that a refund or revised guarantee issued under FR-19 appear "clearly itemized on that same document, rather than being split into a separate correction invoice."

Three questions needed concrete answers for backend-dev to build against: when can generation be attempted, what blocks it, and how does an FR-19 adjustment actually get represented without becoming a second document.

## Decision

**Timing: an explicit, manually-triggered action**, `POST /campaigns/:id/invoice` (section 4.4 of the E6 architecture document), available once two preconditions hold: the campaign's `state` is `active`, `paused`, or `completed` (ruling out `draft`/`quoted`/`confirmed`, where a pool may not exist or may not yet be final), and no `campaign_opportunity` row for the campaign has `status = 'pending'` (ruling out exactly the case US-20 scenario 3 names, "creator opportunities are still pending acceptance"). Automatic generation tied to a specific lifecycle transition (e.g., automatically on `completed`) is explicitly not built in this release -- PRD open question 7 is treated as genuinely open on this point, and this document does not invent a cadence the PRD does not state, consistent with the stories document's own discipline of leaving unresolved timing questions open rather than guessing.

**FR-19 adjustments: itemized line items on the one invoice, never a second document.** `invoice_line_item` (section 3.2 of the E6 architecture document) carries exactly two `line_type` values: `base_price` (always present, equal to `campaign.locked_price`) and `shortfall_refund_adjustment` (present only when E2's existing `pool_shortfall_resolution` row for this campaign has `resolution_type = 'partial_refund'` and is resolved, carrying a negative amount equal to `refund_amount`). A `revised_guarantee` resolution produces no line item at all, because it never changes `locked_price` -- it reduces the guaranteed pool size, not the price Marina pays, so there is nothing for an invoice line to adjust. Budget reallocation (FR-23) similarly produces no line item, for the same reason: it redistributes already-locked spend among creators without changing the campaign's total price.

**Regeneration is not exposed.** A second `POST` against a campaign that already has an invoice returns 409 `INVOICE_ALREADY_GENERATED`. This is a deliberate, narrow scope decision, not a claim that no campaign will ever need a corrected invoice -- it is left as an open item (section 7 of the E6 architecture document) rather than this document inventing a correction/reissue flow the stories document does not describe.

## Consequences

**What Aurora gains:**
- US-20 scenario 3's exact behavior ("refuses to issue the invoice at that point, states why") is a precondition check with a named, specific reason (`pending_opportunities` count in the error payload), not a vague rejection.
- US-20 scenario 2's "single, fixed total price with any refund or credit... clearly itemized on that same document" is true by construction: there is exactly one `invoice` row per campaign, and an FR-19 refund is a second row in a child table of that same invoice, never a second `invoice` row.
- The manual-trigger design means no scheduled job needs to guess the right moment to bill a buyer -- the buyer-facing team (or the buyer themselves, depending on who in practice calls this endpoint) controls timing, which is a safer default than an automated trigger would be while PRD open question 7 remains genuinely unresolved.

**What Aurora gives up:**
- If a campaign never reaches a state where someone calls `POST /campaigns/:id/invoice`, no invoice is ever generated -- there is no safety net ensuring every billable campaign eventually gets billed. This is accepted as a pilot-scale gap, consistent with a small team's capacity to build (and a customer base small enough to track manually) rather than a claim that this is the right design at scale.
- A campaign whose pool composition changes *after* an invoice is issued (which should not happen given the preconditions, but is not database-impossible if, for instance, a shortfall resolution is recorded after invoicing) has no reissue path in this release -- recorded as an open item rather than silently assumed away.

**Risk:** Without a reissue or correction flow, any real-world sequencing error (invoicing before a shortfall resolution is recorded, for instance) produces a permanently incomplete invoice with no in-product fix. Mitigation: the precondition set is deliberately conservative (campaign must be `active` or later, no pending opportunities), narrowing the window in which such a sequencing error could occur, and the gap is recorded explicitly in section 7 of the E6 architecture document rather than left for a future engineer to discover by surprise.
