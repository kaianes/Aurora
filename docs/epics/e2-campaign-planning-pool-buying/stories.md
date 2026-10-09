# E2 -- Campaign Planning and Pool Buying

**Goal:** Let a buyer plan and purchase a creator pool as one predictable media unit, at one fixed price, instead of negotiating with creators one by one.

**Personas:** Marina (brand media manager), Renata (agency partner)

**Journey phases:** Marina campaign setup; Marina live campaign

**Governing NFRs (apply to every story in this epic):**

| NFR | Attribute | Target |
|---|---|---|
| NFR-04 | Performance | Read requests p95 ≤ 500 ms; write requests p95 ≤ 1,500 ms, for all interactive operations |
| NFR-06 | Scalability | A single campaign must support up to 150 creators without breaching the performance targets above |
| NFR-33 | Cost efficiency | Infrastructure cost per campaign tracked from the first campaign onward, trending toward a mid-market ticket (≤ 3% of campaign gross value becomes a hard gate once real volume exists) |
| NFR-34 | Cost efficiency | Cost must not scale linearly with pool size; designed for at pilot scale (up to 150 creators), formally verified once pools approach 5,000 |

---

## US-05 -- Define a Campaign Once

**Persona:** Marina (brand media manager)

**As** Marina, **I want** to define a campaign once with budget, audience, message, and deliverables, **so that** I do not repeat the brief for every creator.

**Priority:** Must

**Related functional requirements:** FR-16

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 1 | Normal: complete campaign definition | Marina is logged into her brand workspace and has a complete or draft brand profile | she enters a budget, audience targeting attributes, a message, deliverable formats, and a timeline, then saves the campaign | the system stores the campaign in the `draft` state with all fields recorded, and she can proceed to request a quote (US-06) without re-entering any of this information. |
| 2 | Hard: campaign saved with partial information | Marina has entered a budget and audience but has not yet finalized the message or deliverables | she saves the campaign | the system persists it as a draft, lets her return to it later, and clearly indicates which fields are still required before a quote can be requested. No quote is generated from an incomplete definition. |
| 3 | Failure: invalid budget or targeting combination | Marina enters a budget below the platform's minimum campaign size, or an audience combination with no addressable creators | she attempts to save or move past the definition step | the system rejects the submission, states the specific reason (minimum budget not met, or targeting too narrow), and preserves everything else she has already entered. |

**Governing NFRs:** NFR-04, NFR-06

**Related epic dependency:** This story feeds US-03 (brand profile defaults, E1) and precedes US-06 (quote).

---

## US-06 -- See Pool Size, Reach, and Price Before Confirming

**Persona:** Marina (brand media manager)

**As** Marina, **I want** to see the estimated pool size, projected reach, and total price before confirming, **so that** I can plan the buy like paid media.

**Priority:** Must

**Related functional requirements:** FR-17

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 1 | Normal: quote produced for a valid campaign | Marina has completed a campaign definition (US-05) with a budget, audience, and deliverables | she requests a quote | the system returns a guaranteed minimum pool size, a projected reach range, and a single total price, all before she confirms anything. The campaign moves to the `quoted` state. |
| 2 | Hard: quote for a tightly constrained audience | Marina's audience targeting is narrow (e.g., a small niche or geography) | she requests a quote | the system still returns a guaranteed minimum pool size and a price, even if the minimum is small, rather than failing silently. If no viable pool exists at all, it tells her clearly instead of returning an empty or misleading quote. |
| 3 | Failure: quoting service cannot complete in time | The matching/pricing engine is degraded or slow when Marina requests a quote | she waits for the result | the system shows a clear loading or retry state rather than a blank screen, and if the quote cannot be produced, it tells her so explicitly instead of returning a stale or partial number. |

**Governing NFRs:** NFR-04, NFR-06

**Related epic dependency:** Depends on US-05; the shortlist mechanics behind the pool-size estimate belong to E3 (FR-25).

---

## US-07 -- Buy the Pool at One Fixed Price

**Persona:** Marina (brand media manager)

**As** Marina, **I want** to buy the creator pool at one fixed price, **so that** my cost is predictable and needs no per-creator negotiation.

**Priority:** Must

**Related functional requirements:** FR-18, FR-19

This is one of the three priority stories expanded in section 3.4 of the PRD. The acceptance criteria below reproduce that expansion in full, since it is the core promise of the epic.

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 1 | Normal: confirming a quote locks the price | Marina has set a budget, an audience, and the content formats she wants (US-05, US-06) | she asks for a quote and accepts it | she gets one total price, a minimum number of creators, and an expected reach. She never has to negotiate with creators one by one. The campaign moves to the `confirmed` state. |
| 2 | Hard: creator costs diverge from the plan during execution | Marina has accepted that quote | creators turn out to cost more or less than planned during sourcing and execution | her price stays the same and Aurora absorbs the difference. Nothing on her invoice (US-20) changes because of per-creator cost variance. |
| 3 | Failure: the pool cannot be filled to the guaranteed minimum | Aurora cannot find enough creators to meet the guaranteed minimum pool size | the launch date arrives | Marina is told before launch and offered either a partial refund or a smaller guarantee. The campaign never starts short without warning her. |

**Governing NFRs:** NFR-04, NFR-06, NFR-33, NFR-34

---

## US-08 -- Save a Campaign as a Reusable Template

**Persona:** Marina (brand media manager)

**As** Marina, **I want** to save a campaign as a reusable template, **so that** recurring campaigns take minutes instead of days.

**Priority:** Should

**Related functional requirements:** FR-22

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 1 | Normal: template created from a confirmed campaign | Marina has a campaign that has gone through quoting and confirmation | she saves it as a template, giving it a name | the system stores the template's structure (audience, message, deliverables, timeline shape) without the campaign's prior budget commitment or historical performance data. The template appears in her template library. |
| 2 | Hard: instantiating a template with updated budget | Marina selects a saved template to start a new campaign | she adjusts the budget or timeline before confirming | the system pre-fills every other field from the template and produces a fresh quote (US-06) reflecting the new budget, rather than reusing the old quote's numbers. |
| 3 | Failure: template references a brand profile element that no longer exists | Marina's brand profile has changed since the template was created (e.g., a prohibited topic removed) | she instantiates the template | the system flags which template fields no longer match the current brand profile and asks her to confirm or update them before the campaign can be quoted. It does not silently apply stale settings. |

**Governing NFRs:** NFR-04, NFR-06

**Note:** FR-22 also covers template reuse across clients in an agency workspace (US-41); that cross-client behavior is specified in the E9 stories document, not here.

---

## US-09 -- Pause, Resume, or Cancel a Running Campaign

**Persona:** Marina (brand media manager)

**As** Marina, **I want** to pause, resume, or cancel a running campaign, **so that** I can react to a brand incident immediately.

**Priority:** Must

**Related functional requirements:** FR-20, FR-21

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 1 | Normal: pausing an active campaign | Marina has a campaign in the `active` state | she pauses it | the campaign moves to the `paused` state, and all pending publications are halted immediately. Creators who have not yet published are notified that the campaign is on hold. |
| 2 | Hard: resuming a paused campaign | Marina has a paused campaign and the incident that triggered the pause is resolved | she resumes it | the campaign returns to the `active` state, and content that was held is released back into the review/publication flow without losing any submitted drafts or history. |
| 3 | Failure: attempting an invalid state transition | Marina has a campaign that is already `completed` or `cancelled` | she attempts to pause or resume it | the system blocks the transition, states that the action is not valid from the current state, and does not alter the campaign's state or any creator's content. |

**Governing NFRs:** NFR-04, NFR-06

---

## US-10 -- Automatic Budget Reallocation to Best-Performing Creators

**Persona:** Marina (brand media manager)

**As** Marina, **I want** the budget to shift automatically toward the best-performing creators, **so that** spend follows results while the campaign is still running.

**Priority:** Should

**Related functional requirements:** FR-23

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 1 | Normal: reallocation within configured bounds | Marina's campaign is `active` and she has configured bounds for how much budget can shift between creators | performance data comes in showing some creators outperforming others | the system reallocates remaining (not-yet-committed) budget toward better-performing creators, staying within the bounds Marina configured, and records the reallocation in the campaign's history. |
| 2 | Hard: performance data is incomplete for some creators | Some creators in the pool have not yet published, so no performance data exists for them | the reallocation logic runs | the system does not penalize or deprioritize creators simply for not having data yet; it reallocates only among creators with sufficient data to compare, and leaves budget committed to not-yet-published creators untouched. |
| 3 | Failure: performance metrics feed is stale or unavailable | The connected social platform metrics feed (FR-52) is degraded or rate-limited | the reallocation job runs on schedule | the system skips reallocation for that cycle rather than acting on stale or missing data, logs that it was skipped, and tries again on the next cycle. The campaign budget remains unchanged and no creator is dropped because of a metrics outage. |

**Governing NFRs:** NFR-04, NFR-06, NFR-34

**Open question:** see "Open questions" section below (reallocation bounds).

---

## Open questions

1. **Reallocation bounds, who sets them and what the defaults are.** FR-23 says reallocation happens "within bounds configured by the buyer," but the PRD does not specify a default bound, a minimum guaranteed share per creator, or whether a creator can be reduced to zero remaining budget mid-campaign. Recommend this be resolved with product/legal before build, since it affects the payout commitment made to creators at acceptance (FR-43/US-29). Recorded here rather than guessed.

2. **Campaign minimum budget threshold (US-05, scenario 3).** The PRD does not state a specific minimum campaign budget. The acceptance criteria above assume such a minimum exists (consistent with a fixed-price pool model needing a viable floor) but the number itself is not specified anywhere in the requirements and needs a business decision.

3. **Partial refund vs. revised guarantee split (US-07, FR-19).** The PRD establishes that Marina must be offered one of these two options when the pool cannot be filled, but does not specify the criteria for which option is offered, or whether Marina chooses or Aurora decides. Recommend clarifying before this story is built.

4. **Template library scope (US-08).** It is not specified whether templates are private to the creating user, shared across the whole brand workspace, or something in between for a non-agency (single-account) workspace. Agency cross-client template sharing is explicitly covered by FR-22/US-41 in E9, but single-workspace sharing is not addressed.
