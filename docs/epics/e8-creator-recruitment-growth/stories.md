# E8 -- Creator Recruitment and Growth

**Goal:** Make a good creator findable and invitable even if she never self-registers, by recruiting her actively, qualifying her honestly and fast, and then growing her into a creator Aurora's mid-market brands actually see -- the one durable, hard-to-copy advantage the business analysis identified (section 1.3, section 2.3).

**Personas:** Duda (nano creator)

**Journey phases:** Duda discovery; Duda onboarding; Duda growth

**Governing NFRs (apply to every story in this epic, per Table 15):**

| NFR | Attribute | Target |
|---|---|---|
| NFR-15 | Confidentiality | Zero social platform credentials stored. Authorization tokens only, encrypted at rest and rotated at least every 90 days |
| NFR-20 | Privacy | **[Promise holds]** Unclaimed creator profiles: publicly available data only, deleted automatically after 90 days if unclaimed, never exposed to any brand-facing surface |
| NFR-21 | Compliance | LGPD data subject rights (access, correction, deletion, portability) fulfilled within 15 days |
| NFR-22 | Compliance | Every consent recorded with timestamp, scope, and the version of the terms accepted |
| NFR-24 | Usability | Creator onboarding median completion ≤ 10 minutes across no more than 5 steps |

Two further non-functional requirements are defined in section 5.2 against FRs that belong to this epic (NFR-26 against FR-08/FR-11, NFR-35 against FR-09) but are not echoed in Table 15's E8 row. Both are attached to the relevant stories below on the strength of their own FR-level definition, and the gap in Table 15 is recorded under Open Questions rather than silently resolved either way.

**Builds on, does not duplicate, E3's `creator` entity.** E3 (Creator Matching and Curation) already shipped a minimal `creator` table sized to what matching needed, specifically designed to be extended rather than replaced by this epic (ADR-0013; see `docs/architecture/e3-creator-matching-curation.md` section 2.2). It already defines: `id`, a nullable `user_id` (null until claim), `display_name`, a `status` enum (`unclaimed | active | suspended`, with `unclaimed` reserved but unused by E3), an `onboarding_status` enum (`qualified | not_qualified | pending`), and the metrics fields US-12 needs (`audience_size`, `demographic_composition`, `engagement_rate`, `content_niche`, `authenticity_score`, `metrics_computed_at`, `metrics_stale`). No story below recreates any of that. Instead, these stories populate those existing fields for the first time (registration drives `user_id` and `status`; metrics computation and the authenticity check drive the metrics columns and `metrics_computed_at`) and add the columns E3 explicitly left for this epic: social account links, media kit data, rate preferences, and the unclaimed-profile lifecycle itself (creation, claim, decline, deletion).

---

## US-23.1 -- Unclaimed Profile Created from Public Data

**Tag:** US-23

**Persona:** Duda (nano creator)

**As** Duda, **I want** Aurora to be able to build a basic profile about me from publicly available information before I have ever signed up, **so that** I can be found and considered for recruitment without having to register first myself.

**Priority:** Must

**Related functional requirements:** FR-12

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 1 | Normal: unclaimed profile created and quarantined | Aurora identifies a creator who never signed up, using only publicly available data | it builds a profile for her | the profile is created with `status = unclaimed`, is never matched to any campaign, and is not visible on any brand-facing surface. This holds from the moment of creation, not after a later review step. |
| 2 | Hard: public data is incomplete | Aurora can only observe a handful of public signals (e.g., a handle and an estimated follower count, with no verified engagement data since she has not linked any account via FR-08) | it builds the unclaimed profile | the system stores only what it actually observed, leaves the fields it cannot verify (engagement rate, authenticity score, demographic composition) null rather than estimating or inferring a value, and the profile remains excluded from matching exactly as a complete one would be -- incompleteness is never a reason to relax the unclaimed exclusion. |
| 3 | Failure: the profile is never claimed | An unclaimed profile has existed for 90 days without being claimed | the retention window elapses | the system automatically deletes the profile and all the public data it imported, sends no further invitation about it, and this deletion requires no manual trigger (NFR-20). |

**Governing NFRs:** NFR-20

**Related epic dependency:** Feeds US-23.2 (invitation and claim) directly. The reserved `unclaimed` status value and nullable `user_id` column this story populates already exist on the `creator` table per ADR-0013; this story is the first thing that actually writes `status = 'unclaimed'` to it.

---

## US-23.2 -- Invitation and Claim Flow

**Tag:** US-23

**Persona:** Duda (nano creator)

**As** Duda, **I want** to be invited to review and correct a profile Aurora built about me, or to refuse it outright, **so that** nothing about me goes live on the platform without my knowledge and consent.

**Priority:** Must

**Related functional requirements:** FR-13

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 1 | Normal: Duda accepts and corrects her imported data | An unclaimed profile exists for Duda (US-23.1) and Aurora invites her | she accepts the invitation | she is shown exactly what was imported, can correct any field before it goes live, and the profile only becomes active (`status = active`) after she confirms it, not automatically on acceptance alone. |
| 2 | Hard: imported data is wrong in more than one place | Duda opens the review step and finds her niche, follower count, and display name are all inaccurate | she corrects each field and submits | all of her corrections are saved as the authoritative values (not merged with or overwritten by the original imported data), and the profile activates with her corrected data, not Aurora's guess. |
| 3 | Failure: Duda refuses the invitation | Duda opens the invitation and declines | she submits her refusal | the system records her answer, deletes everything it imported about her, does not contact her again about that campaign, and the profile is removed rather than left dormant in an unclaimed state. |

**Governing NFRs:** NFR-20, NFR-21, NFR-22

**Related epic dependency:** Consumes US-23.1's unclaimed profile. Its successful-accept path is what E3's agency-override flow (US-40, FR-29) relies on when Renata tries to add a creator with "no profile" or "onboarding incomplete" (see E3 architecture doc section 3.6, `suggested_action: invite`) -- that invite action is this story, not a new one E3 builds itself.

---

## US-24.1 -- Link Social Accounts via Platform Authorization

**Tag:** US-24

**Persona:** Duda (nano creator)

**As** Duda, **I want** to register and link my social accounts through the platforms' own authorization flows, **so that** Aurora can see my real audience data without ever asking for my passwords.

**Priority:** Must

**Related functional requirements:** FR-08

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 1 | Normal: successful account linking | Duda is registering on Aurora | she chooses to connect a social account and completes that platform's own OAuth authorization screen | Aurora stores only the resulting authorization token, encrypted at rest, and never asks for or stores her platform password. The consent is recorded with a timestamp, its scope, and the version of the terms she accepted. |
| 2 | Hard: Duda later revokes access from the platform's own side | Duda has an active, linked account | she revokes Aurora's access from the social platform's own settings, outside Aurora entirely | the next token refresh attempt fails, Aurora detects this and marks the connection as disconnected rather than continuing to display a stale "connected" status, and she is prompted to relink without losing any other data already on her profile. |
| 3 | Failure: authorization is denied or unavailable | Duda starts the authorization flow for a platform | she denies permission, or the platform's authorization service is unavailable | Aurora does not treat this as a registration failure. It names the specific platform that failed to connect, lets her retry or continue onboarding with whichever platforms she has successfully connected, and never substitutes a stored credential or a workaround of any kind. |

**Governing NFRs:** NFR-15, NFR-22, NFR-24, NFR-26 (see the note on this epic's Table 15 gap above)

**Related epic dependency:** Writes `user_id` on the `creator` row for the first time (ADR-0013) when the registering account is new, or reuses an existing claimed-but-incomplete row when this follows US-23.2's claim flow.

---

## US-24.2 -- Compute and Maintain Audience Metrics

**Tag:** US-24

**Persona:** Duda (nano creator)

**As** Duda, **I want** Aurora to compute my audience size, demographics, engagement rate, and niche from my linked accounts, and keep them current, **so that** brands see an accurate, up-to-date picture of my audience without me assembling it by hand.

**Priority:** Must

**Related functional requirements:** FR-09

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 1 | Normal: initial computation at onboarding | Duda has linked at least one social account (US-24.1) | Aurora computes her metrics | audience size, demographic composition, engagement rate, and content niche are stored on her profile and are available to the qualification step (FR-11) within the onboarding session, not after a separate delay. |
| 2 | Hard: metrics need to stay current after onboarding | Duda is an active creator whose real follower count and engagement shift over time | the platform's scheduled metrics refresh runs | her metrics are recomputed, `metrics_computed_at` is updated, and this is the actual computation E3's staleness flag already assumes exists (see E3 architecture doc section 4, `refresh-creator-metrics-staleness` job) -- this story is what feeds that flag real data instead of only tracking its age. |
| 3 | Failure: the linked platform's API is rate-limited or down | A scheduled metrics refresh is due for Duda | the linked platform's API is rate-limited or temporarily unavailable | Aurora retries with backoff, continues serving her last-known metrics marked as stale rather than blanking them, and this outage never blocks her onboarding completion or an active campaign's matching that depends on her existing numbers (NFR-35). |

**Governing NFRs:** NFR-35 (see the note on this epic's Table 15 gap above), NFR-24

**Related epic dependency:** This is the computation E3's US-12 explicitly defers to E8 ("FR-09 and FR-10 are produced by M2... this story specifies how those metrics surface in the matching context, not how they are computed," E3 stories.md). US-12 is not duplicated here; US-12 only renders what this story produces.

---

## US-24.3 -- Compute Authenticity Score

**Tag:** US-24

**Persona:** Duda (nano creator)

**As** Duda, **I want** my follower base checked for fraud and anomalous engagement, **so that** my profile reflects a real, trustworthy audience when a brand looks at it.

**Priority:** Must

**Related functional requirements:** FR-10

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 1 | Normal: score computed alongside audience metrics | Duda's accounts are linked and her audience metrics are computed (US-24.2) | Aurora runs the authenticity check | it produces a 0-100 authenticity score detecting follower fraud and anomalous engagement patterns, stores it, and makes it available for the display E3's US-12 already specifies (flagged, not hidden, per that story's acceptance criteria and ADR-0017's threshold policy). |
| 2 | Hard: the score comes back low | Duda's computed score falls below the platform's low-authenticity threshold | the score is finalized | it is recorded and exposed exactly as a high score would be. It does not automatically disqualify her or silently exclude her from onboarding; only the qualification decision (US-24.4, FR-11) governs her matching eligibility, consistent with E3's flag-only policy (ADR-0017). |
| 3 | Failure: not enough data to compute a reliable score | Duda's linked account is too new or has too little activity for the fraud-detection model to produce a confident result | the computation runs | Aurora does not fabricate a score. It is recorded as pending/unavailable rather than defaulted to a number that implies a judgment it cannot support, and this alone does not block the rest of her qualification decision from completing. |

**Governing NFRs:** NFR-24

**Related epic dependency:** Same relationship as US-24.2 to E3's US-12: this story computes what US-12 displays.

---

## US-24.4 -- Qualification Decision at the End of Onboarding

**Tag:** US-24

**Persona:** Duda (nano creator)

**As** Duda, **I want** to be told immediately at the end of onboarding whether I qualify for campaigns, and exactly what is missing if I do not, **so that** I am not left guessing after filling out a long form.

**Priority:** Must

**Related functional requirements:** FR-11

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 1 | Normal: Duda qualifies | Duda has linked at least one account (US-24.1) and her metrics are computed (US-24.2, US-24.3) | she completes the final onboarding step | the system immediately tells her she qualifies and sets her status to active/qualified within the same session, making her eligible for matching (FR-25, E3) without a separate manual review delay. |
| 2 | Hard: Duda does not qualify | Duda's computed metrics fall short of a specific published criterion (for example, engagement rate or audience size below the minimum) | she completes the final onboarding step | the system names the specific criterion or criteria she is missing, not a generic rejection, so she knows exactly what would change the outcome. |
| 3 | Failure: the decision cannot be made yet | Duda reaches the final onboarding step before her linked account's metrics have finished computing | the qualification check runs | the system does not force her to wait indefinitely or fail silently. It tells her the decision is pending, gives an expected timeframe, and notifies her once it is ready, rather than leaving her status undetermined with no communication. |

**Governing NFRs:** NFR-24, NFR-26 (see the note on this epic's Table 15 gap above)

**Related epic dependency:** This is the gate for US-26 (mid-market visibility) and for every E3 matching story: `onboarding_status = qualified` combined with `status = active` is what makes a creator eligible for a shortlist at all.

---

## US-25 -- Automatic Media Kit

**Tag:** US-25

**Persona:** Duda (nano creator)

**As** Duda, **I want** an automatic media kit built from my real campaign data, **so that** I can prove my value without assembling one by hand.

**Priority:** Should

**Related functional requirements:** FR-14

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 1 | Normal: media kit generated from real history | Duda has completed at least one campaign with recorded performance data | she opens her media kit | Aurora generates a document from her real campaign history and audience metrics that she can export and share, with no manual compilation of screenshots or numbers on her part. |
| 2 | Hard: Duda has no completed campaigns yet | Duda has just qualified (US-24.4) but has not delivered any campaign | she requests her media kit | Aurora still generates a kit using the real data that exists -- her audience metrics -- and clearly separates that from a campaign-performance section, which it states will populate once she delivers her first campaign. It never fabricates campaign results she has not earned. |
| 3 | Failure: generation or export fails | Duda requests to export her media kit | the generation or export process fails | the system tells her generation failed and offers a retry, rather than producing a blank or partially rendered document that misrepresents her. |

**Governing NFRs:** None of Table 15's five apply directly; no NFR in Table 14 names FR-14 in its "Constrains" column at all. See Open Questions.

**Related epic dependency:** Draws on campaign performance data that is E7's scope to produce (FR-54, US-37) and on the audience metrics this epic computes (US-24.2, US-24.3). Does not duplicate E7's creator-performance dashboard; the media kit is an export artifact, not a new reporting surface.

---

## US-26 -- Visibility to Mid-Market Brands

**Persona:** Duda (nano creator)

**As** Duda, **I want** to be visible to mid-market brands, **so that** I am not limited to barter offers from local businesses.

**Priority:** Should

**Related functional requirements:** None directly. See Open Questions -- no FR-08 to FR-15 entry, nor any other FR in the catalog, is traced to US-26. The acceptance criteria below describe the behavior as the combination of FR-11 (qualification) and FR-25 (E3's shortlist ranking) that the PRD's own traceability implies, not a newly invented mechanism.

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 1 | Normal: qualified creators are eligible for any matching brand | Duda is active and qualified (US-24.4) | any brand, including a mid-market brand that self-registered under E1, runs a campaign whose audience targeting matches her profile | she is eligible to appear on that campaign's shortlist (FR-25, E3) exactly as any other qualified creator would be. No separate "mid-market" tier or extra registration step exists or is required. |
| 2 | Hard: Duda was actively recruited rather than self-registered | Duda's profile originated as an unclaimed profile she later claimed (US-23.1, US-23.2) | she completes onboarding and qualifies | her matching eligibility is identical to a creator who self-registered. The system does not restrict recruited creators to a smaller or lower-tier pool of opportunities because of how their profile originated. |
| 3 | Failure: leftover recruitment state blocks matching | Duda's profile has completed the claim flow and is marked active and qualified | a shortlist generation runs for a campaign she matches | she is not silently excluded because of a leftover `unclaimed` flag or any other artifact of the recruitment process. Her eligibility is based solely on her current `status` and `onboarding_status`, never on her profile's origin. |

**Governing NFRs:** None identified. See Open Questions.

**Related epic dependency:** Entirely downstream of US-24.4 (qualification) and E3's FR-25 (shortlist ranking). This story does not add a matching mechanism of its own.

---

## US-27 -- Creator-Set Rate Preferences

**Persona:** Duda (nano creator)

**As** Duda, **I want** to set and update my own rate per deliverable format, **so that** I have a say in what my work is worth.

**Priority:** Could

**Related functional requirements:** FR-15

Rate preferences are an input to Aurora's internal payout computation, not a line item a brand negotiates. Per section 3.5's resolution of the tension between US-07 (fixed pool pricing) and this story, Aurora absorbs the variance between what it pays a creator and what it charges a brand, so a rate preference changes what Duda is offered, not what Marina's quoted price is.

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 1 | Normal: Duda sets a rate | Duda is an active, qualified creator | she sets a rate preference for a specific deliverable format (e.g., Instagram Reel) | the system stores and displays that preference on her profile, available as an input to the payout figures an opportunity for that format will show her (US-29, E6). |
| 2 | Hard: Duda updates her rate after opportunities already exist | Duda has one or more pending or accepted opportunities priced under her previous rate | she changes her rate preference and saves it | the change applies only to opportunities created from that point forward. Any already-created opportunity keeps its original payout figures unchanged, consistent with the immutability of opportunity payout figures once created (E3 architecture doc section 2.5). She is told the new rate applies going forward, not retroactively. |
| 3 | Failure: Duda enters an invalid rate | Duda enters a rate value outside a valid range (for example, negative, zero, or implausibly high) | she attempts to save it | the system rejects the input with a clear reason and does not silently clamp, round, or otherwise substitute a different number without telling her. |

**Governing NFRs:** None of Table 15's five apply directly. See Open Questions regarding whether NFR-23 (financial data minimization and access control) should extend to rate preference data.

**Related epic dependency:** Feeds E6's opportunity payout computation (US-28/FR-30 in E3, US-29/FR-43 in E6) as an input only; does not touch E2's fixed pool price (FR-18).

---

## Open questions

1. **US-26 has no traced functional requirement.** The story catalog and Table 15 both place US-26 in E8, but no FR in section 4.2 (not FR-08 to FR-15, not any other FR) is traced to it. The acceptance criteria above describe the only mechanism the PRD actually specifies (qualification plus E3's matching), but this means there is no measurable target confirming recruited or nano creators are actually surfaced to mid-market brands specifically, nor any visibility or prioritization mechanic distinct from ordinary matching. Recommend confirming with product whether a dedicated requirement was intended, or whether "visibility" is meant to be entirely emergent from FR-11 plus FR-25 as modeled here.

2. **NFR-26 and NFR-35 are defined against this epic's FRs but omitted from Table 15's E8 row.** Section 5.2 states NFR-26 (WCAG 2.2 AA) explicitly constrains FR-08 and FR-11, and NFR-35 (graceful degradation on rate limiting/outage) explicitly constrains FR-09. Table 15's summary row for E8 lists neither. The stories above attach both anyway, on the strength of the FR-level definition, but the inconsistency between the two tables in the source document should be resolved rather than left for each epic's stories to interpret independently.

3. **Identity ambiguity when building an unclaimed profile (US-23.1) is not addressed.** FR-12 says a profile is built "from publicly available data" but the PRD does not say what happens if that public data is ambiguous across two or more real people with similar public presences (e.g., same display name, different actual person). The acceptance criteria above only cover incomplete data, not ambiguous/conflicting data about identity. This is a real risk given the LGPD stakes already flagged in section 3.5, and needs a product decision rather than an assumption.

4. **Ongoing LGPD data-subject rights for an already-claimed, active creator are not specified beyond the claim-time decline.** NFR-21 commits to fulfilling access, correction, deletion, and portability requests within 15 days, and its own "Constrains" column names only FR-13 (the claim/decline flow). FR-13 only covers the moment of claiming or declining an invitation. There is no FR describing what happens if an already-active creator who has worked campaigns later wants to exercise an access, correction, deletion, or portability request outside that one moment. This gap should be closed with an explicit story before NFR-21 can be verified in full.

5. **Authenticity score behavior with insufficient data (US-24.3, scenario 3) is assumed, not specified.** The PRD requires the score to be computed and exposed (FR-10) but says nothing about what happens when there is not enough data to compute it reliably. The "pending/unavailable" behavior above is the analyst's best-effort assumption, not a documented requirement, and should be confirmed with product before being built as specified.

6. **Valid rate bounds for US-27 are undefined.** FR-15 allows a creator to "record rate preferences per deliverable format" but does not define what makes a rate valid (currency, minimum, maximum, or whether it must be a single number versus a range). This is a product decision needed before the failure-case behavior in US-27 scenario 3 can be built precisely.

7. **No performance target exists for media kit generation or export (US-25).** NFR-05 sets a 30-second target for campaign report export (FR-53); no analogous target exists for FR-14. Recommend confirming whether one is needed before this Should-priority story is built.

8. **Creator acquisition cost has no measurable NFR.** The business analysis (sections 1.3, 2.3, 2.5, 2.8) names active creator recruitment as Aurora's "signature cost and risk" and flags "recruiting creators is too expensive at scale" as a high-impact risk, but section 5.2 of the PRD defines no NFR tracking cost-per-recruited-creator, claim conversion rate, or any other measurable target for the recruitment funnel this epic builds (US-23.1, US-23.2). Without one, this epic can be built and tested functionally but the actual bet the business analysis is making cannot be verified in production. Recommend this be raised for a future NFR revision rather than assumed to be out of scope permanently.
