# E3 -- Creator Matching and Curation

**Goal:** Replace slow, manual matching with a ranked shortlist a buyer can trust and act on in minutes, while preserving the human judgment -- Marina's approval, Renata's curation -- that automation must support rather than replace.

**Personas:** Marina (brand media manager), Renata (agency partner), Duda (nano creator)

**Journey phases:** Marina matching; Renata curation; Duda opportunity

**Governing NFRs (apply to every story in this epic):**

| NFR | Attribute | Target |
|---|---|---|
| NFR-01 | Performance | Shortlist generation must complete fast enough to feel interactive rather than batch: p95 ≤ 60 seconds for campaigns of up to 100 creators |
| NFR-06 | Scalability | A single campaign must support up to 150 creators without breaching NFR-01 or NFR-04 |
| NFR-29 | Modifiability | The matching model should be replaceable as it improves, without disturbing the money path: replacing it should not require changes to campaign or payment code, nor a database migration |

---

## US-11 -- Automatic Shortlist Ranked by Fit

**Persona:** Marina (brand media manager)

**As** Marina, **I want** an automatic shortlist of creators ranked by fit, **so that** I do not wait days for a manual list.

**Priority:** Must

**Related functional requirements:** FR-25, FR-26

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 1 | Normal: shortlist produced for a confirmed campaign | Marina's campaign is `quoted` or `confirmed` with a budget, audience targeting attributes, and brand profile defaults applied | she requests the shortlist (or it is generated automatically on confirmation) | the system returns a ranked list of eligible creators meeting at least the guaranteed minimum pool size from the quote (US-06), within 60 seconds at p95 for campaigns of up to 100 creators. Each entry states the specific campaign attributes that creator satisfied (FR-26). |
| 2 | Hard: campaign targets a narrow or saturated niche | Marina's audience targeting is narrow enough that fewer eligible creators exist than the guaranteed minimum | the shortlist is generated | the system returns every eligible creator it has, ranked, and flags explicitly that the pool is below the guaranteed minimum rather than padding the list with poor matches or failing silently. This ties back to the FR-19 warning obligation handled in US-07 (E2). |
| 3 | Failure: matching engine cannot complete in time | The matching engine is degraded, under heavy load, or an upstream dependency (creator metrics) is unavailable when Marina requests the shortlist | the 60-second target is exceeded or the engine errors | the system shows a clear in-progress or retry state rather than a blank or partial list, and if it ultimately fails, tells Marina explicitly rather than returning a stale or truncated shortlist. |

**Governing NFRs:** NFR-01, NFR-06, NFR-29

**Related epic dependency:** Consumes the guaranteed minimum pool size and audience attributes from US-05/US-06 (E2); its output feeds US-13 (approval) and US-28 (opportunity delivery).

---

## US-12 -- Inspect Audience and Authenticity Metrics

**Persona:** Marina (brand media manager)

**As** Marina, **I want** to inspect each creator's audience and authenticity metrics, **so that** I can trust the match instead of guessing from a follower count.

**Priority:** Must

**Related functional requirements:** FR-09, FR-10

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 1 | Normal: metrics visible on a shortlisted creator | Marina has a generated shortlist (US-11) | she opens a creator's profile from the shortlist | she sees audience size, demographic composition, engagement rate, content niche, and an authenticity score that flags follower fraud or anomalous engagement, all computed per creator (FR-09, FR-10). |
| 2 | Hard: creator has a low or flagged authenticity score | A shortlisted creator's authenticity score indicates likely follower fraud or anomalous engagement | Marina views that creator's profile | the system surfaces the low score prominently rather than burying it among other metrics, and does not automatically remove the creator from the shortlist. The decision to approve or reject stays with Marina (US-13). |
| 3 | Failure: metrics are stale or unavailable for a creator | A creator's social platform connection is rate-limited or temporarily unreachable (per NFR-35) | Marina opens that creator's profile | the system shows the last-known metrics clearly marked as stale, with a timestamp, rather than hiding the metrics or showing a blank state. The creator is not silently dropped from the shortlist because of a metrics outage. |

**Governing NFRs:** NFR-01, NFR-06

**Related epic dependency:** FR-09 and FR-10 are produced by M2 (Creator Network and Profiles); this story specifies how those metrics surface in the matching context, not how they are computed (that detail lives with E8's onboarding stories).

---

## US-13 -- Approve or Reject Individual Creators on a Shortlist

**Persona:** Marina (brand media manager)

**As** Marina, **I want** to approve or reject individual creators in the shortlist, **so that** I keep final say over who represents the brand.

**Priority:** Must

**Related functional requirements:** FR-28

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 1 | Normal: approving and rejecting individual creators | Marina has a generated shortlist (US-11) for a campaign that has not yet activated | she approves some creators and rejects others, one by one or in bulk | the system records each decision, removes rejected creators from the pool that will receive opportunities (US-28), and keeps approved creators in the pool moving toward activation. |
| 2 | Hard: rejections drop the approved pool below the guaranteed minimum | Marina rejects enough creators that the approved pool falls below the guaranteed minimum pool size from the quote | she confirms the last rejection | the system warns her before the campaign can activate, states that the pool is now below the guaranteed minimum, and offers to request additional candidates from the matching engine rather than silently activating an under-filled campaign. |
| 3 | Failure: attempting to approve/reject after activation | Marina's campaign has already moved to the `active` state | she attempts to change an approval decision on the original shortlist | the system blocks the change and states that shortlist decisions are locked once the campaign is active; any further creator changes must go through the campaign controls (pause, in US-09) rather than retroactively editing the shortlist. |

**Governing NFRs:** NFR-01, NFR-06

**Related epic dependency:** Gated by US-11 (shortlist must exist) and gates US-28 (only approved creators receive opportunities).

---

## US-14 -- Exclusion List for Creators and Competitor Associations

**Persona:** Marina (brand media manager)

**As** Marina, **I want** to maintain an exclusion list of creators and competitor associations, **so that** conflicts never reach a shortlist.

**Priority:** Should

**Related functional requirements:** FR-27

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 1 | Normal: brand-level exclusion applied before shortlisting | Marina has added specific creators and a competitor brand association to her brand-level exclusion list | a shortlist is generated for any of her campaigns | no excluded creator appears on the shortlist. The exclusion is applied before ranking, not filtered out afterward. |
| 2 | Hard: campaign-level exclusion overlaps with brand-level exclusion | Marina adds a campaign-specific exclusion for a creator who is also on her brand-level exclusion list | the shortlist for that campaign is generated | both exclusions apply with no conflict; the creator is excluded regardless of which list caused it, and the system does not require her to reconcile duplicate entries manually. |
| 3 | Failure: exclusion added after a shortlist already exists | Marina adds a creator to her exclusion list after a shortlist has already been generated and some creators already approved (US-13) | the exclusion is saved | the system does not retroactively remove an already-approved creator from an active or approved shortlist; it applies the exclusion to future shortlist generations and tells Marina that existing approvals are unaffected unless she manually revokes that creator's approval. |

**Governing NFRs:** NFR-01, NFR-06

---

## US-28 -- Creator Reviews and Accepts/Declines an Opportunity

**Persona:** Duda (nano creator)

**As** Duda, **I want** to review an opportunity and accept or decline it, **so that** I choose which brands I work with.

**Priority:** Must

**Related functional requirements:** FR-30

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 1 | Normal: Duda accepts an opportunity | Duda has been approved onto a campaign's shortlist (US-13) and receives an opportunity stating the campaign, the deliverable, the payout, and an expiry | she reviews it and accepts before the expiry | the system records her acceptance, confirms the gross/commission/net payout figures to her (US-29, E6), and moves her into the active pool for that campaign's briefing (US-18/US-30, E5). |
| 2 | Hard: Duda declines an opportunity | Duda reviews the same opportunity | she declines it | the system records the decline, removes her from that campaign's active pool, and does not penalize her future eligibility for other campaigns. If the decline drops the pool below the guaranteed minimum, the system flags that for the buyer per the FR-19 obligation handled in E2. |
| 3 | Failure: opportunity expires before a response | Duda neither accepts nor declines before the stated expiry | the expiry passes | the system automatically treats the opportunity as expired (not declined, not accepted), removes her from the pending pool for that slot, and notifies her that the opportunity is no longer available. No payout obligation is created. |

**Governing NFRs:** NFR-01, NFR-06

**Related epic dependency:** Depends on US-13 (only approved creators receive opportunities); feeds US-29 (payout transparency, E6) and US-30 (briefing, E5).

---

## US-40 -- Agency Overrides the Shortlist with Its Own Network

**Persona:** Renata (agency partner)

**As** Renata, **I want** to override the shortlist and add creators from my own network, **so that** my curation stays the product I sell.

**Priority:** Must

**Related functional requirements:** FR-29

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 1 | Normal: Renata removes and adds creators | Renata has a generated shortlist (US-11) for a client campaign in her agency workspace | she removes system-ranked creators she does not want and adds creators from her own network (either existing Aurora profiles or newly invited ones) | the system records her final selection as the shortlist for that campaign, distinct from the system's original ranking, and that selection proceeds to opportunity delivery (US-28) exactly as a system-ranked shortlist would. |
| 2 | Hard: Renata's selection is finalized and the system does not reorder it | Renata has made her additions and removals and saved the shortlist | any subsequent process runs (e.g., a scheduled re-ranking job, or budget reallocation per US-10) | the system does not reorder, re-rank, or replace Renata's curated selection. Her list is authoritative once saved, matching the FR-29 guarantee that it is never altered after the fact. |
| 3 | Failure: Renata adds a creator who is not yet eligible on Aurora | Renata attempts to add a creator from her network who has no Aurora profile, or whose profile has not completed onboarding qualification (FR-11) | she submits the addition | the system does not silently add an ineligible creator to the shortlist; it tells Renata the creator must first complete onboarding (or triggers an invitation flow per FR-13/US-23 if the creator is entirely new to Aurora) before they can be added to a client campaign. |

**Governing NFRs:** NFR-01, NFR-06, NFR-16 (tenant isolation applies: Renata's override must only touch the client account she is acting under)

**Related epic dependency:** This is the point where E3 intersects with E9 (agency multi-client operations); the underlying client-isolation guarantee is specified fully in the E9 stories document, not repeated here.

---

## Open questions

1. **What happens to creators approved under the original shortlist when Renata overrides it (US-40, scenario 1).** FR-29 says the agency's final selection "shall not reorder or replace" afterward, but the PRD does not state whether Renata's override happens before or after creators have already been notified of a pending opportunity under the original system shortlist. Recommend clarifying the exact sequencing: does the override replace the shortlist before any opportunity is sent, or can it happen after some creators have already seen an opportunity based on the system ranking?

2. **Guaranteed minimum enforcement on an agency override (US-40).** It is unspecified whether Renata's curated selection must still meet the campaign's guaranteed minimum pool size from the quote (US-06, FR-17), or whether an agency override is exempt from that guarantee since it is explicitly a judgment call rather than an algorithmic fill. Recorded here rather than assumed.

3. **Exclusion list conflict with agency network additions (US-14 and US-40 interaction).** The PRD does not say whether a brand's exclusion list (US-14) applies to creators Renata adds from her own network in a client campaign, or whether agency curation can override a client's exclusion list. This matters for brand safety and needs a product decision.

4. **Rejection threshold notification details (US-13, scenario 2).** FR-28 establishes that the buyer can approve or reject individual creators, but does not specify how the system should surface "request additional candidates" as an action, nor whether that re-triggers a new quote (US-06) or simply tops up the existing one. Left as an implementation detail for the architecture/design phase, but flagged since it touches the pricing promise in US-07.

5. **Authenticity score threshold for automatic exclusion (US-12).** FR-10 requires the authenticity score to be computed and exposed, but the PRD does not define a minimum score below which a creator is excluded from matching entirely versus merely flagged for Marina's judgment. The acceptance criteria above assume flagging only, with no automatic exclusion, consistent with E3's strategic role of preserving human judgment -- but this should be confirmed with product rather than assumed permanently.
