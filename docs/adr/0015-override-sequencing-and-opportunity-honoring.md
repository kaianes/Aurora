# ADR-0015: Agency Override Is Permitted Any Time Before Activation; Already-Accepted Opportunities Are Honored, Pending Ones Are Not Revoked

**Status:** Proposed
**Date:** 2026-10-05
**Epic:** E3 -- Creator Matching and Curation
**Governs:** US-40, US-28, FR-29, FR-30

## Context

PRD open question 1 asks whether Renata's override must happen before any creator has seen an opportunity based on the system ranking, or whether it can happen after -- and if after, what becomes of creators who were already notified. FR-29 only states the override "shall not reorder or replace" the selection *afterward*, which governs mutations to the override itself, not the sequencing question of when the override can first happen relative to opportunity delivery.

Three sequencing rules were considered:

- **Force the override to happen before any opportunity is sent**, by gating opportunity delivery on an explicit "override window closed" signal from the agency. This is the cleanest mental model but adds a manual gate step to every agency campaign (even ones where Renata has no intention of overriding), slowing down the common case to protect against an edge case.
- **Allow the override at any point before activation, and silently revoke any opportunity already sent to a creator the override removes.** Rejected: revoking an opportunity a creator has already *accepted* breaks the promise US-28 makes to Duda ("I choose which brands I work with" -- having chosen yes, that choice should not be unilaterally reversed by someone she has no relationship with), and it contradicts US-28's own framing that acceptance "moves her into the active pool for that campaign's briefing," a state change E3 should not casually undo.
- **Allow the override at any point before activation; honor what has already happened, and only prevent what has not.** Pending (not-yet-responded) opportunities for a removed creator are left standing but effectively orphaned (the creator can still accept or decline, but a removed creator's acceptance does not re-add them to the locked shortlist -- see below); accepted opportunities for a removed creator stand as a commitment already made.

## Decision

An agency override can be saved at any point while the shortlist is `ready` and not yet `locked` -- there is no separate "override window" gate, and opportunity delivery does not block overriding. When the override removes a creator (`remove_entry_ids`):

- If that creator has no `campaign_opportunity` row yet, nothing further happens -- they simply never receive one, which is the common case and requires no special handling.
- If that creator has a `pending` opportunity, it is left as-is (not deleted or force-expired). The creator can still accept or decline it normally. However, because the shortlist entry's `included` is now `false`, an acceptance on a removed creator's opportunity does **not** add them back into `campaign_pool_member` at activation -- the opportunity resolves for the creator's own record-keeping (so she is never left with a mysteriously vanished, unexplained opportunity) but does not re-open the locked shortlist. The creator-facing response to an accept in this state includes a note that the campaign's final pool has since changed, instead of a bare success message, so Duda is told rather than left to find out later.
- If that creator has an `accepted` opportunity, the override still removes them from `campaign_shortlist_entry.included`, but E3 does **not** retroactively cancel the acceptance or the pending briefing/payout hand-off it already triggered (US-28's event to E5/E6 already fired and is not revocable from this epic). This is a deliberate inconsistency in favor of the creator: Renata's curation authority governs who Aurora *offers* a campaign to, not who gets uninvited after saying yes.

## Consequences

**What Aurora gains:**
- Agencies keep a simple mental model: override whenever you want, up until activation. No new manual gate slows down campaigns where Renata has no override to make.
- Creators who accepted in good faith never have that acceptance unilaterally reversed by a later curation decision, protecting the specific promise US-28 makes and avoiding a support/trust incident that would be disproportionate to the coordination problem it would solve.
- The rule is enforced structurally (via `included` plus the one-time `campaign_pool_member` write at lock time, ADR-0012), not through a manual reconciliation step someone has to remember to run.

**What Aurora gives up:**
- A campaign can end up paying for (or crediting toward the pool) a creator Renata explicitly tried to remove, if that creator had already accepted. This is a narrow, self-limiting edge case (it requires both an unusually early opportunity send and a subsequent override touching that same creator) and is judged acceptable against the alternative of occasionally breaking a promise made directly to a creator.
- The "pending opportunity on a removed creator" state needs a slightly more careful frontend message (US-28's accept flow has to explain a pool change) than a plain accept confirmation. This is a small, one-time UX cost, flagged here for frontend-dev rather than discovered during implementation.
