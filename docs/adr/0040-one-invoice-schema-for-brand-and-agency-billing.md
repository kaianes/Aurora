# ADR-0040: One Invoice Schema Serves Both Direct-Brand (US-20) and Agency-Client (US-42) Billing, With No Agency-Specific Table

**Status:** Proposed
**Date:** 2026-10-21
**Epic:** E6 -- Payments and Financial Transparency
**Governs:** US-20, US-42, FR-48, FR-49

## Context

US-20 (Marina, a direct brand buyer) and US-42 (Renata, an agency partner billing on behalf of a client) read, on the surface, like two different billing problems: FR-48 names "the buyer" generically, while FR-49 specifically names "consolidated billing per client account for agency workspaces, while Aurora settles the underlying creator payouts directly." The stories document itself, however, already argues the two converge: US-42 scenario 1 states the client "receives one consolidated invoice for its own campaigns, **exactly as US-20 describes** for a direct brand buyer," and the epic's own related-dependency note calls US-42 "the agency-specific analog of US-20," not a distinct mechanism.

The question this ADR resolves is whether that textual similarity should become one schema or two. A second, agency-specific `agency_client_invoice` table (or an agency-specific extension of `invoice`) was considered, on the reasoning that "consolidated **per-client**" sounds like it names a billing concept distinct from "per-campaign." Examining what that phrase is actually contrasting against resolves the question: US-42 scenario 2's concern is "billing never bleeds across two different clients in the same workspace... no line item, total, or creator-cost figure from one client ever appears on another client's invoice" -- this is describing isolation between clients, not aggregation across a client's multiple campaigns into one periodic bill. FR-49 itself does not say "one invoice per client per billing period"; US-42's own acceptance criteria describe a per-campaign invoice scoped correctly to one client, which is exactly FR-48's shape.

## Decision

**`invoice` and `invoice_line_item` (section 3.2 of the E6 architecture document) serve both US-20 and US-42 identically, with no agency-specific schema, no agency-specific endpoint, and no agency-specific code path.** An invoice is scoped to `campaign_id`, and a campaign's `account_id` is already, by construction, either a brand's own single account or one specific agency client account -- FR-06 and FR-07's existing tenancy model already guarantees that a client account's data (campaigns, creators, content, and now invoices) is isolated from every other client account in the same agency workspace. `POST /campaigns/:id/invoice` and `GET /campaigns/:id/invoice` (section 4.4 of the E6 architecture document) are the only two endpoints either story needs; US-42's "consolidated per-client" guarantee is satisfied entirely by the account-scoped RLS policy FR-07 already enforces, not by anything new this epic builds.

The one genuinely agency-specific half of US-42 -- "Aurora settles the underlying creator payouts directly," never passing money through the agency -- requires no new mechanism either: it is exactly what US-35a through US-35c already build, unmodified by this ADR, since creator payout obligations are keyed to `content_submission`/`campaign_opportunity`, never to the campaign's buyer account at all. A creator's payout is the same mechanism whether the campaign's owning account is a brand's own or an agency's client's, which is precisely the property US-42 scenario 3 requires ("creator payouts already obligated... continue to be executed and settled within their own committed windows... regardless of the state of Aurora's billing relationship with the agency's client").

## Consequences

**What Aurora gains:**
- Zero additional schema, endpoints, or role logic for US-42 beyond what US-20 already needed -- the entire agency billing story is satisfied by composing two things two other epics already built (FR-07's account isolation, and this epic's own US-35a-c creator-payout mechanism) rather than a third, parallel invoicing system.
- US-42 scenario 2's cross-client bleed guarantee inherits FR-07's existing, already-tested isolation property rather than needing its own, newly-written isolation test -- a correctness property this platform already depends on for every other kind of agency data, extended here at zero marginal risk.
- Any future change to invoice generation (a new line-item type, a different timing rule) automatically applies to both direct-brand and agency-client billing, since there is only one code path to change.

**What Aurora gives up:**
- If product later wants genuinely agency-specific invoice behavior -- an agency's own branding on the invoice document (FR-57's white-labeling, E9's scope), a single invoice spanning several of a client's campaigns in one billing period, or agency-specific payment terms -- none of that exists today, and adding it means extending this shared schema carefully rather than having an agency-specific table already standing ready to carry new fields without touching the brand-facing path.
- The word "consolidated" in US-42's own title could mislead a future reader into expecting cross-campaign aggregation that this design deliberately does not build, since FR-48's per-campaign framing (which US-42 explicitly inherits) does not ask for it. This ADR exists partly to make that reading explicit rather than leaving it to be rediscovered.

**Risk:** If product's actual intent for "consolidated per-client" billing was cross-campaign aggregation (a single periodic statement per client, not per campaign), this design would need a different shape -- a new aggregating entity above `invoice`, not a change to `invoice` itself. Mitigation: this ADR names the specific textual evidence (US-42 scenario 1's "exactly as US-20 describes") the reading rests on, so a future product clarification that contradicts it is a visible, traceable disagreement with a stated architectural decision, not a silent surprise.
