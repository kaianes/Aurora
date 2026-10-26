# E7 -- Analytics and Reporting

**Goal:** Replace results scattered across several platforms and spreadsheets with one dashboard and one exportable report, per creator and per pool, so that proving ROI becomes a document anyone can hand to a CMO, a CFO, or a client, instead of a reconstruction project.

**Personas:** Marina (brand media manager), Renata (agency partner), Duda (nano creator)

**Journey phases:** Marina reporting and renewal; Renata reporting; Duda growth

**Strategic role (Table 1):** Turns campaign results into the ROI argument that drives renewal.

**Governing NFRs (apply to every story in this epic, per Table 15 of the PRD):**

| NFR | Attribute | Target |
|---|---|---|
| NFR-02 | Performance | The unified dashboard must render quickly with a campaign history loaded: p95 ≤ 3 seconds first render with up to 6 months of history |
| NFR-05 | Performance | Report export must complete within a single working session: ≤ 30 seconds for campaigns of up to 100 creators |
| NFR-08 | Scalability | Metric ingestion must keep pace with pilot campaign volume, on a pipeline that can scale horizontally later: 20,000 performance events per day |
| NFR-35 | Interoperability | Social platform integrations must degrade gracefully rather than fail the campaign: on rate limiting or outage, the system retries with backoff, serves last-known metrics marked as stale, and never blocks content submission or payout |

These four sit alongside the eight NFRs that govern the whole platform without appearing in any epic's table (NFR-07, NFR-10, NFR-12, NFR-14, NFR-18, NFR-28, NFR-30, NFR-31), per section 5.3 of the PRD.

Unlike E5 and E6's stories documents, no inconsistency was found between Table 14's "Constrains" column and Table 15's E7 row: every NFR in Table 14 that names FR-51 through FR-56 (NFR-02, NFR-05, NFR-08, NFR-35) is already present in Table 15's E7 row. The one apparent omission -- NFR-25 (creator-facing viewport, Table 14 Constrains: "All creator-facing FRs") is not named for E7 even though FR-54 is plainly creator-facing -- is not treated as the same class of problem, because NFR-25's Constrains column names a category rather than a specific FR number the way NFR-26 named FR-36 and FR-43 in the E5 and E6 cases. This document follows Table 15 as the authoritative per-epic curation and does not add NFR-25 to any E7 story, consistent with how the E6 stories document also did not add it to the creator-facing US-36a.

**Integration points this epic must account for, not rebuild.**

This epic does not own most of the data it reports on. It aggregates entities four prior epics already built, and introduces exactly one new kind of data: ingested social-platform performance metrics (FR-52).

- **Campaign and budget data comes from E2.** The campaign's fixed quoted price (`campaign_quote.total_price`, locked at confirmation under FR-18), the pool membership (`campaign_pool_member`), and the campaign lifecycle state (`campaign.state`, FR-20) are all read from E2's existing entities, not recomputed here. "Spend" in a report (FR-53) is this fixed price, or the consolidated invoice total once one exists (US-20, E6) -- the two should agree by construction, since FR-18 holds the quoted price fixed regardless of per-creator cost variance.
- **E2's own `reallocate-budget` job already depends on this epic's FR-52 by name.** E2's architecture (`docs/architecture/e2-campaign-planning-pool-buying.md`, section on scheduled jobs) states its reallocation job "pulls performance data for pool members with sufficient data" and explicitly checks whether "the metrics feed (FR-52) is stale/unavailable" before acting. That dependency already exists in production code for E2; this epic is not introducing a new consumer, it is building the producer E2 is already calling. The ingestion pipeline built for US-21a below must expose an interface E2's existing job can call without a migration to E2's own tables, matching the `MATCHING_ENGINE_ADAPTER`-style seam E2 and E3 already used for an equivalent handoff (NFR-29).
- **Shortlist, opportunity, and payout-figure data comes from E3.** `campaign_shortlist_entry` and `campaign_opportunity` (with its immutable `payout_gross`/`payout_commission`/`payout_net` columns) establish which creators are in a pool and what each was promised, but -- per US-07's design that the buyer never negotiates or sees cost per creator -- this document does not assume a per-creator dashboard or report exposes any individual creator's payout figure to Marina or Renata. See Open questions.
- **Delivery and publication data comes from E5.** `content_submission.published_url` and `published_at` (set by E5's `POST /creator-portal/content-submissions/:id/confirm-publication`) are the record of which creators actually delivered, as distinct from which creators were merely approved onto a pool. This epic's "delivered reach" and "engagement" figures (FR-53) are computed only over creators with a confirmed publication, not the full approved pool, consistent with the plain meaning of "delivered." A creator who was approved but never published contributes to pool-size reporting but not to delivered-reach totals.
- **Financial totals and the consolidated invoice come from E6.** `invoice`/`invoice_line_item` (US-20, FR-48) and `payout_obligation` (US-35a, FR-44) are E6's entities. This epic reads them for the "spend" side of a report; it does not duplicate the ledger or recompute a payout figure.
- **The one genuinely new entity this epic introduces is the ingested performance metric itself (FR-52).** No prior epic's architecture defines a table for raw reach/engagement/impression data pulled from a connected social platform over the life of a campaign. Building that ingestion pipeline, keeping it within NFR-08's throughput target, and degrading it gracefully per NFR-35 is this epic's own, uninherited scope. Ingestion depends on a creator having a linked social account with a valid authorization token (FR-08, E8) -- a dependency this epic assumes exists but does not itself build, since E8 is a separate epic not yet covered by any architecture document at the time of this writing.
- **US-43 (FR-55) and US-46 (FR-56) depend on E9 entities that do not yet exist in any stories or architecture document.** Per-client branding (FR-57) and the client-account structure itself (US-38, US-39, FR-06, FR-07) belong to E9, which has not been written yet. This document specifies what Renata's stories need from that structure without inventing it.

Neither of these points changes what Marina, Renata, or Duda experience; both are named here so the acceptance criteria below can be built against the real data each prior epic already produces, instead of an assumed or duplicated source.

---

## US-21a -- Ingest Performance Metrics from Connected Social Platforms *(sub-story of US-21, tagged US-21)*

**Persona:** Marina (brand media manager) -- the consuming persona; the behavior itself is backend infrastructure with no direct UI

**As** Marina, **I want** Aurora to continuously pull real performance data from every creator's connected social account throughout a live campaign, **so that** the dashboard I see (US-21b) reflects what is actually happening, not a snapshot from launch day.

**Priority:** Should

This is split out from US-21 because ingesting metrics (FR-52) and presenting them on a dashboard (FR-51) are two separable, separately testable behaviors with different priorities in the PRD's own M8 table -- FR-51 is Must, FR-52 is Should. The PRD's catalog marks the parent story US-21 as Must overall; this document resolves that the same way the E6 stories document resolved an equivalent mismatch for US-36 (history Must, tax documentation Should): the sub-story inherits its own FR's priority rather than the parent story's blanket label, so the catalog accurately reflects what can and cannot be descoped under schedule pressure.

**Related functional requirements:** FR-52

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 1 | Normal: metrics are pulled and attached to the right creator and campaign | A creator has a confirmed publication (`content_submission.published_at` set, E5) in an `active` campaign, and her social account carries a valid authorization token (FR-08, E8) | the ingestion pipeline runs its scheduled pull for that platform | the system records that creator's current reach, engagement, and impression figures for that specific published piece of content, attributed unambiguously to her creator ID and the campaign's ID, within NFR-08's throughput target of 20,000 events per day platform-wide. |
| 2 | Hard: the platform rate-limits or temporarily outages the pull | A connected social platform returns a rate-limit response or is unreachable when the pipeline attempts a scheduled pull | the pull fails | the system retries with backoff, continues to serve the last-known metrics for that creator marked clearly as stale with the timestamp of their last successful pull, and never blocks content submission (E5) or payout execution (E6) as a side effect of the outage, per NFR-35. |
| 3 | Failure: a creator revokes or loses her social account authorization mid-campaign | A creator's authorization token (FR-08) is revoked, expired, or invalidated between pulls | the pipeline attempts its next scheduled pull for that creator | it does not fail silently or substitute another creator's or a cached-forever figure; it marks that creator's metrics as stale going forward, logs the authorization failure distinctly from a transient rate-limit failure, and surfaces that distinction wherever her metrics are later displayed (US-21b, US-37), rather than conflating "temporarily unreachable" with "permanently lost." |

**Governing NFRs:** NFR-08, NFR-35

**Related epic dependency:** Feeds US-21b (dashboard), US-22 (report export), US-37 (creator's own performance view), and E2's existing `reallocate-budget` job, which already expects this exact feed to exist (see epic header integration note).

---

## US-21b -- Unified Dashboard: Results by Creator and by Pool *(sub-story of US-21, tagged US-21)*

**Persona:** Marina (brand media manager)

**As** Marina, **I want** one dashboard showing results by creator and by pool, **so that** I stop assembling metrics from several platforms.

**Priority:** Must

**Related functional requirements:** FR-51

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 1 | Normal: results render per creator and aggregated across the pool | Marina has a campaign with at least one creator who has confirmed publication and whose metrics have been ingested (US-21a) | she opens the campaign's dashboard | she sees, within 3 seconds at p95 with up to 6 months of history loaded (NFR-02), a per-creator breakdown of delivered performance (reach, engagement) for every creator who has published, and a single aggregated total across the whole pool, in the same view, without switching platforms or assembling the numbers herself. |
| 2 | Hard: the pool mixes creators who have and have not yet delivered | The campaign is still `active`, and some approved creators have published while others have not yet submitted or confirmed publication | Marina views the dashboard | creators who have not yet published are shown distinctly (for example, as "pending delivery") rather than silently omitted or shown with zeroed, misleading performance figures indistinguishable from a creator who genuinely delivered zero engagement. The pool-level aggregate is computed only from creators who have actually delivered, and the dashboard states how many of the pool have and have not yet published. |
| 3 | Failure: the ingestion feed behind the dashboard is degraded | Metrics for one or more creators in the pool are marked stale or unavailable (US-21a, scenario 2 or 3) | Marina views the dashboard during that degradation | the dashboard still renders within the NFR-02 target using the last-known figures, each visibly marked stale with its timestamp, rather than failing to render, blocking on the degraded source, or silently presenting stale data as current. |

**Governing NFRs:** NFR-02, NFR-08, NFR-35

**Related epic dependency:** Consumes the metrics pipeline from US-21a; feeds the export in US-22. Reads pool membership from E2 (`campaign_pool_member`) and delivery confirmation from E5 (`content_submission.published_at`).

---

## US-22 -- Export a Report That Proves ROI

**Persona:** Marina (brand media manager)

**As** Marina, **I want** to export a report that proves ROI, **so that** I can defend the spend to my CMO and CFO.

**Priority:** Must

**Related functional requirements:** FR-53

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 1 | Normal: a complete report exports in both formats within a working session | Marina has a campaign with a fixed quoted price (E2, FR-18) and at least one confirmed, metrics-ingested delivery (US-21a) | she requests an export | the system produces a report stating spend, delivered reach, engagement, and a cost-efficiency figure, available as both a portable document and a tabular file, completing within 30 seconds at p95 for campaigns of up to 100 creators (NFR-05). |
| 2 | Hard: the campaign is still active, not yet invoiced | Marina requests an export for a campaign that has not yet reached a billable point (US-20, E6 has not yet generated an invoice) | she requests the report | the system still produces it, using the fixed quoted price as the spend figure (consistent with FR-18 holding that price fixed from confirmation onward) and the delivery data confirmed so far, and states clearly that the campaign is still in progress rather than presenting a mid-campaign export as if it were a final, completed-campaign report. |
| 3 | Failure: no creator in the pool has delivered anything yet | Marina requests an export for a campaign where every approved creator is still pending delivery, with no confirmed publication and no ingested metrics | she requests the report | the system does not fabricate placeholder reach, engagement, or cost-efficiency figures; it produces a report that states spend (the fixed price, already known at confirmation) and explicitly states that no deliveries have occurred yet, rather than returning zeros that would misleadingly read as poor performance. |

**Governing NFRs:** NFR-05, NFR-08, NFR-35

**Related epic dependency:** Reads the same aggregated figures as US-21b; reads spend from E2's fixed price (FR-18) and, once generated, E6's invoice (US-20, FR-48).

---

## US-37 -- See How My Content Performed

**Persona:** Duda (nano creator)

**As** Duda, **I want** to see how my content performed, **so that** I can improve and demonstrate results to future brands.

**Priority:** Should

**Related functional requirements:** FR-54

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 1 | Normal: a creator sees her own delivered performance | Duda has confirmed publication for a campaign (E5, US-34) and her metrics have been ingested (US-21a) | she opens her performance view | she sees the reach and engagement figures for her own delivered content on that campaign, and only her own, with no other creator's figures visible on the same view. |
| 2 | Hard: her metrics are temporarily stale | The social platform feed for Duda's account is rate-limited or briefly unreachable (US-21a, scenario 2) | she opens her performance view during that window | she still sees her last-known figures, clearly marked stale with the timestamp of the last successful pull, rather than a blank state or an error that gives her no information at all. |
| 3 | Failure: a creator attempts to view performance for content she never delivered | Duda has an opportunity she declined, or one still pending delivery, with no confirmed publication | she attempts to view performance for that specific piece of work | the system shows no performance figures for it (there are none to show) and does not substitute another creator's figures, another of her own campaigns' figures, or a misleading zero that would read as a real, measured result. |

**Governing NFRs:** NFR-08, NFR-35

**Related epic dependency:** Reads the same per-creator ingestion feed as US-21a and US-21b, scoped to the requesting creator's own identity only.

---

## US-43 -- Per-Client Reports Under Renata's Own Branding

**Persona:** Renata (agency partner)

**As** Renata, **I want** per-client reports under my own branding, **so that** I deliver them as my agency's work.

**Priority:** Should

**Related functional requirements:** FR-55

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 1 | Normal: a client report carries the agency's branding, not Aurora's | Renata's agency workspace holds a client account with at least one campaign that has delivered data (US-21a), and the agency has configured its branding (FR-57, E9) | Renata requests a report for that one client | the report contains the same content a direct-brand report would (spend, delivered reach, engagement, cost efficiency per US-22), but rendered with the agency's logo and colors in place of Aurora's, so it reads as the agency's own deliverable. |
| 2 | Hard: the agency runs several clients, each needing its own report | Renata's workspace holds more than one client account | she requests reports for more than one client | each report contains only that one client's campaigns and figures; no line item or total from one client ever appears on another client's report, consistent with the isolation guarantee E9's own stories document specifies for client data generally. |
| 3 | Failure: Renata requests a report for a client account she does not have access to | Renata's agency workspace holds a client account she has not been granted access to under per-client permissions (US-45, E9), or she attempts to request a report for a client outside her own agency workspace entirely | she requests the report | the system refuses the request and does not return any figures for that client, consistent with tenant and client-account isolation (treated here as it was in E3's US-40: a specific application of NFR-16 even though NFR-16 is not listed among this epic's own governing NFRs in Table 15). |

**Governing NFRs:** NFR-02, NFR-05, NFR-08, NFR-35, and NFR-16 (client-account isolation applies to scenario 3; see note above and E3's US-40 precedent)

**Related epic dependency:** Depends entirely on E9 (not yet specified) for the client-account structure and the branding configuration (FR-57) this report applies; otherwise reuses the same reporting content as US-22.

---

## US-46 -- Compare Performance Across Clients

**Persona:** Renata (agency partner)

**As** Renata, **I want** to compare performance across my clients, **so that** I can apply what works in one account to another.

**Priority:** Could

**Related functional requirements:** FR-56

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 1 | Normal: a side-by-side comparison across two or more clients | Renata's agency workspace holds at least two client accounts, each with at least one campaign carrying delivered performance data | she requests a cross-client comparison | she sees the same per-pool aggregate figures (US-21b) for each of her clients' campaigns, side by side, within her own agency workspace. |
| 2 | Hard: clients differ in campaign volume and timeframe | One client has run several campaigns over months; another has run a single short campaign | Renata runs the comparison | the system presents each client's own figures honestly (for example, totals and per-campaign averages) rather than normalizing them in a way that implies a false equivalence between a client with one campaign and a client with many, and does not silently exclude a client with less data. |
| 3 | Failure: the comparison is requested across workspaces, not just across clients within one | Renata attempts to include a client account that belongs to a different agency's workspace, or one outside her own granted access (per US-45, E9) | she requests the comparison | the system refuses to include that client's data, consistent with the same client-account isolation guarantee as US-43's failure case, and does not silently drop it from the result in a way indistinguishable from "this client simply has no data." |

**Governing NFRs:** NFR-02, NFR-05, NFR-08, NFR-35, and NFR-16 (client-account isolation applies to scenario 3; see US-43's note)

**Related epic dependency:** Depends on the same E9 client-account structure as US-43, and reuses US-21b's per-pool aggregation for each client's own campaigns.

---

## Open questions

1. **No formula is specified anywhere in the PRD for "cost efficiency" (US-22, FR-53).** FR-53 names it as one of four required figures in the export, but no section of the document states the calculation -- cost per unit of reach, cost per engagement, a CPM-equivalent, or something else. This document reports spend, delivered reach, and engagement as separate figures and leaves the specific cost-efficiency formula as an open product decision rather than guessing one.

2. **Whether a per-creator breakdown (FR-51, FR-53) ever shows an individual creator's cost or payout to the buyer is not addressed by the PRD.** US-07's entire design rationale is that Marina pays one fixed price and never negotiates or sees cost per creator, and NFR-23 restricts access to creator financial data by role. This document assumes a per-creator dashboard or report entry shows only performance (reach, engagement, delivery status), never that creator's individual `payout_gross`/`commission`/`net` figures, as the only reading consistent with US-07 and NFR-23 -- but the PRD does not state this exclusion explicitly, so it is recorded as an inference rather than a confirmed rule.

3. **"Delivered reach" is computed here only from creators with a confirmed publication, not the full approved pool, and the PRD does not state this explicitly.** This document infers that reading from the plain meaning of "delivered" and from FR-42/FR-44's existing distinction between an approved creator and a confirmed delivery, but no functional requirement states whether a creator who was approved and briefed but never published should count toward pool size only, toward a "pending" bucket, or should be excluded from the report entirely. The acceptance criteria above treat her as visible but excluded from delivered-reach totals.

4. **No ingestion cadence or latency target is stated for an individual creator's metrics, only an aggregate platform-wide daily volume (NFR-08, 20,000 events/day).** The PRD does not say how often a given creator's figures should be refreshed, or how much delay between a post going live and its first metrics appearing is acceptable. This document assumes a scheduled pull without specifying its frequency.

5. **US-43 (FR-55) and US-46 (FR-56) depend on E9 entities -- the client-account structure (US-38, US-39) and branding configuration (FR-57) -- that are not yet specified in any stories or architecture document at the time of this writing.** This document states what Renata's two E7 stories need from that structure (isolated client data, a configured branding surface) without inventing the structure itself. These two stories cannot be fully built until E9's own stories document exists.

6. **No fallback is specified for US-43 when an agency has not yet configured its own branding (FR-57's default state).** Whether an unbranded client report falls back to a neutral, agency-agnostic template or to Aurora's own branding is not stated by the PRD, and the E9 branding story this depends on has not been written yet either. Recorded here rather than assumed, since defaulting to Aurora's branding would arguably contradict US-43's own stated purpose ("I deliver them as my agency's work").

7. **NFR-05 (report export) and, for context, NFR-01 (shortlist generation, E3) both state their performance targets only "for campaigns of up to 100 creators," while NFR-06 permits a pool of up to 150 creators.** This gap predates this epic and was not flagged in E3's stories document either, but it bears directly on US-22: there is no committed performance target for exporting a report on a campaign at the platform's actual pool ceiling (101 to 150 creators), only for the smaller range NFR-05 names. Recorded here so it is visible rather than silently assumed to extend to 150.

8. **No retention period is stated for the raw ingested performance metrics themselves (FR-52), distinct from the platform-wide structured-log retention of 30 days (NFR-32).** NFR-02 requires the dashboard to render with up to 6 months of history, which implies the underlying metrics must be retained at least that long, but the PRD does not state a retention period for the metric data itself, nor whether it is retained beyond 6 months for any purpose (for example, a creator's media kit under FR-14, E8, which draws on "real campaign history"). This document assumes retention at least covers NFR-02's 6-month window and does not assume anything beyond that.
