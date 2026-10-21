# E6 -- Payments and Financial Transparency

**Goal:** Replace payment that is slow, opaque, and non-negotiable with a payout that is visible before a creator ever commits, settled within a promised window, and traceable afterward for every party who touches the money, so that paying creators fast becomes a provable operational commitment rather than a goodwill gesture.

**Personas:** Duda (nano creator), Marina (brand media manager), Renata (agency partner)

**Journey phases:** Duda payment; Marina reporting; Renata billing

**Strategic role (Table 1):** The deepest creator pain and the most credible promise Aurora can keep.

**Governing NFRs (apply to every story in this epic, per Table 15 of the PRD):**

| NFR | Attribute | Target |
|---|---|---|
| NFR-11 | Reliability | **[Promise holds]** ≥ 95% of payout obligations settled by the committed deadline, whether the transfer runs automatically or an operator triggers it by hand; any remainder resolved manually within the same window with the obligation visibly flagged as in progress |
| NFR-13 | Integrity | **[Promise holds]** No financial obligation may ever be lost, duplicated, or silently altered. Zero tolerance. The payment ledger must be append-only and fully reconcilable against campaign records at any point in time |
| NFR-17 | Accountability | Security-relevant and financial actions must be attributable after the fact: immutable audit log covering authentication, authorization changes, and all financial events, retained 5 years |
| NFR-19 | Authentication | Multi-factor authentication available to all users and mandatory for roles that can approve payouts or change bank details |
| NFR-23 | Privacy | Only data with a stated purpose is collected; access to creator financial data restricted by role and logged on every access |
| NFR-36 | Interoperability | Payout logic depends on an internal abstraction, so a payment provider can be replaced without changes to FR-44 through FR-47 behavior |

These six sit alongside the eight NFRs that govern the whole platform without appearing in any epic's table (NFR-07, NFR-10, NFR-12, NFR-14, NFR-18, NFR-28, NFR-30, NFR-31), per section 5.3 of the PRD.

**A seventh NFR worth flagging explicitly for this epic:** Table 14's own "Constrains" column names **FR-43** (the gross/commission/net/date breakdown shown before a creator accepts) as one of only four flows required to meet **NFR-26** (WCAG 2.2 level AA), alongside onboarding and briefing. Table 15's E6 row does not list NFR-26 among this epic's governing NFRs, which is the same kind of inconsistency between the two tables that E5's stories document already flagged for FR-36 -- not a deliberate exclusion, since FR-43 is named explicitly in NFR-26's own target. This document therefore attaches NFR-26 to US-29 specifically (the story that builds the pre-acceptance breakdown), in addition to the six epic-wide NFRs above, rather than silently dropping a requirement the PRD states elsewhere.

**Integration points this epic must account for, not rebuild.**

- **The payout-obligation trigger (US-35a, FR-44) is the one E5 explicitly left for this epic to pick up, not invent.** E5's `POST /creator-portal/content-submissions/:id/confirm-publication` endpoint (`docs/architecture/e5-briefing-content-workflow.md`, section 4.6) already sets `published_url` and `published_at` on the `content_submission` row and writes the audit log entry `content_submission.publication_confirmed`, in the same transaction as calling `BrandSafetyGateService.recordPublication`. E5's own architecture states this directly: "No payout obligation is created here (FR-44 is E6's scope...); this endpoint's only downstream effect beyond the two writes above is the audit log entry, which a future E6 implementation can key off." This epic's obligation-creation logic is expected to key off that `publication_confirmed` event and the `published_at` field being set, not off a separately invented signal. A further consequence: by the time that event fires, E5's own precondition check (`content_review_decision.decision = approved`, enforced before publication can even be confirmed) has already guaranteed FR-44's second condition ("the content has passed approval"). US-35a therefore does not need to re-verify approval independently; the event firing at all already implies it.
- **FR-43's gross/commission/net figures are already displayed on the opportunity a creator accepts, built by E3, not by this epic.** E3's `campaign_opportunity` entity carries immutable `payout_gross`, `payout_commission`, and `payout_net` columns, exposed on `GET /creator-portal/opportunities` and in the `accept` response (`docs/architecture/e3-creator-matching-curation.md`, section 3.7), locked by a database trigger the moment the opportunity is created so a creator never sees one figure before acceptance and a different one after. E3's own architecture is explicit that it only signals the hand-off: "Emit `opportunity.accepted` event, consumed by... E6 (US-29 payout transparency) -- E3 does not implement either, only signals the hand-off." The one field FR-43 requires that E3's existing surface does not yet carry is the **expected payment date**. This epic's scope for US-29 is narrower than it looks at first read: add the expected payment date to an existing, already-correct read surface, not reimplement the gross/commission/net display.

Neither integration point changes what Duda, Marina, or Renata experience; both are named here so the acceptance criteria below can be built against the real hand-off surfaces instead of an assumed one.

---

## US-29 -- See Gross, Commission, and Net Payout Before Accepting

**Persona:** Duda (nano creator)

**As** Duda, **I want** to see gross amount, commission, and net payout before I accept, **so that** I am never surprised by what I actually receive.

**Priority:** Must

**Related functional requirements:** FR-43

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 1 | Normal: all four figures are visible before any commitment | Duda has received an opportunity (US-28, E3) she has not yet responded to, carrying its already-fixed `payout_gross`, `payout_commission`, and `payout_net` figures | she opens the opportunity before accepting or declining | she sees the gross amount, the commission amount, the net amount she would actually receive, and the specific date by which payment is expected, all displayed together, before she commits to any decision. Net is always exactly gross minus commission. |
| 2 | Hard: the figures never show a visible mismatch, even under rounding | The commission computation produces a value that does not divide evenly to the cent for a given gross amount | the figures are displayed | gross, commission, and net are each shown to two decimal places in BRL, and net is always exactly gross minus commission as displayed; any rounding is resolved before display rather than leaving Duda looking at three numbers that do not add up. |
| 3 | Failure: a closed opportunity never still looks like a live offer | An opportunity has expired, been declined, or is otherwise no longer open to a decision (US-28, E3, scenarios 2 and 3) | Duda attempts to view its payout breakdown | the system does not present the breakdown as a current, actionable offer; it is clearly shown as closed, consistent with E3's own guarantee that no payout obligation is ever created from a closed opportunity. Nothing resembling a live "accept and receive X" figure remains displayed as if it were still on the table. |

**Governing NFRs:** NFR-11, NFR-13, NFR-17, NFR-19, NFR-23, NFR-36, and NFR-26 (WCAG 2.2 AA; see epic header note)

**Related epic dependency:** Builds on `campaign_opportunity.payout_gross/commission/net`, already built and immutable per E3 (US-28, FR-30). This story's own scope is adding the expected payment date to that existing surface, derived from whichever committed-window value applies to the opportunity (see Open questions).

---

## US-35a -- Create a Payout Obligation When Publication Is Confirmed and Approved *(sub-story of US-35, tagged US-35)*

**Persona:** Duda (nano creator)

**As** Duda, **I want** my payout obligation to be created the moment my publication is confirmed and my content has passed approval, **so that** the clock on my payment starts exactly when my delivery is actually done, not later.

**Priority:** Must

This is split out from US-35 because obligation creation (FR-44), settlement within the window (FR-45), and failure handling (FR-46) are three separable, separately testable behaviors with separate verbs in the PRD ("create," "execute," "notify"). Folding all three into one story would hide the one behavior NFR-13's zero-tolerance ledger constraint bears on most directly: the moment a financial obligation is first written.

**Related functional requirements:** FR-44

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 1 | Normal: publication confirmation creates exactly one obligation | Duda has confirmed publication of approved content (US-34, E5; `content_submission.publication_confirmed` audit event fired, `published_at` set) | the system processes that confirmation | it creates exactly one payout obligation for that submission, carrying the gross/commission/net figures already fixed at acceptance (US-29, FR-43) and the payment deadline committed at that same acceptance, and the obligation is immediately visible to Duda as owed. |
| 2 | Hard: a redelivered or retried confirmation never creates a duplicate | The `publication_confirmed` event for a given submission is processed more than once (for example, because of a retried delivery or a redelivered message) | the system handles the repeat delivery | it creates at most one payout obligation for that submission, never a second one, keeping obligation creation idempotent on the submission's identity rather than on the number of times the triggering event was received. |
| 3 | Failure: no obligation is created without both preconditions genuinely met | The system receives a signal to create a payout obligation for a submission whose publication was never actually confirmed, or whose review decision is not `approved` (a state E5's own publication-confirmation gate should prevent from ever reaching this point) | the obligation-creation step runs | it refuses to create an obligation, logs why, and never creates a placeholder, zero-value, or provisional obligation as a side effect of an unexpected or malformed trigger. |

**Governing NFRs:** NFR-11, NFR-13, NFR-17, NFR-19, NFR-23, NFR-36

**Integration note:** Keys off the exact hand-off E5 built for this purpose: `content_submission.published_at` being set and the `content_submission.publication_confirmed` audit event, written by E5's `POST /creator-portal/content-submissions/:id/confirm-publication` (section 4.6 of E5's architecture). Because that endpoint already requires `content_review_decision.decision = approved` before it will record a publication at all, this story does not need to re-verify approval independently -- the event firing at all already implies it.

**Related epic dependency:** Depends entirely on US-34 (E5) for the triggering event; feeds US-35b (execution) and US-36a (the creator's visible history).

---

## US-35b -- Execute the Payout Within the Committed Window *(sub-story of US-35, tagged US-35)*

**Persona:** Duda (nano creator)

**As** Duda, **I want** my payout executed within the window Aurora committed to when I accepted the job, **so that** creating content becomes stable income rather than a gamble.

**Priority:** Must

**Related functional requirements:** FR-45

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 1 | Normal: the payout settles by the committed deadline | A payout obligation exists (US-35a) carrying the deadline committed to Duda at acceptance (US-29, FR-43) | the committed deadline arrives | the system has executed the payout and funds have moved to Duda by that deadline, meeting the specific window promised to her, not a generic or later date. |
| 2 | Hard: obligations with different committed deadlines in the same campaign settle independently | Several creators in the same campaign confirmed publication on different dates, each carrying its own committed deadline computed from its own acceptance date | their respective deadlines arrive at different times | each obligation settles against its own committed deadline, not against the campaign's publication date, a shared "batch" date, or another creator's clock. A creator who confirmed earlier is never held to the pace of one who confirmed later, or vice versa. |
| 3 | Failure: automated settlement cannot complete before the deadline | An automated payout run fails to execute a given obligation before its committed deadline (for example, a scheduling or provider issue, as distinct from a payout that executes but is then declined -- see US-35c) | the deadline approaches or is reached without automatic settlement | the system falls back to a manual trigger, settled within the same committed window per NFR-11, with the obligation visibly flagged as "in progress" rather than silently late or indistinguishable from an obligation that settled normally. |

**Governing NFRs:** NFR-11, NFR-13, NFR-17, NFR-19, NFR-23, NFR-36

**Related epic dependency:** Executes the obligation created in US-35a; a failure to settle (as opposed to a failure to execute in time) is handled by US-35c.

---

## US-35c -- Notify Duda Within 24 Hours When a Payout Fails *(sub-story of US-35, tagged US-35)*

**Persona:** Duda (nano creator)

**As** Duda, **I want** to be told within 24 hours, with a reason, whenever a payout fails, **so that** a failed payment never quietly disappears and I always know what is still owed to me.

**Priority:** Must

**Related functional requirements:** FR-46

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 1 | Normal: a failed payout is surfaced with a reason inside 24 hours | A payout execution attempt (US-35b) fails (for example, the payment provider declines the transfer) | the system detects the failure | it tells Duda the specific reason within 24 hours of detecting it, and the obligation stays listed as owed rather than disappearing from her view. |
| 2 | Hard: repeated failed attempts never reset or hide the clock | A payout obligation fails more than once across successive retry attempts | each subsequent attempt also fails | Duda is not left waiting past 24 hours from the *first* detected failure for any explanation, and the obligation remains visibly owed throughout every retry, not silently "in limbo" between attempts. |
| 3 | Failure: the notification channel itself cannot be reached | Duda's notification channel (for example, email) is unreachable or bounces when the system attempts to tell her about a failure | the notification delivery itself fails | the obligation still appears, within her own payment history (US-36a), as owed with the stated failure reason, regardless of whether the outbound notification was successfully delivered -- visibility inside the product never depends solely on an external notification succeeding. |

**Governing NFRs:** NFR-11, NFR-13, NFR-17, NFR-19, NFR-23, NFR-36

**Related epic dependency:** Reacts to a failed execution from US-35b; its "stays listed as owed" guarantee is the same obligation record US-36a renders to Duda.

---

## US-36a -- See Full Payment History and Downloadable Statements *(sub-story of US-36, tagged US-36)*

**Persona:** Duda (nano creator)

**As** Duda, **I want** to see my full payment history and download statements, **so that** I always know what I have earned and what is still owed.

**Priority:** Must

This is split out from US-36 because payment history (FR-47, Must) and tax documentation (FR-50, Should) carry different priorities in the PRD's own M7 table and are genuinely separate artifacts: one is a running ledger view, the other a jurisdiction-specific legal document. Folding a Should-priority requirement into a Must-priority story would blur which part of US-36 the product cannot ship without.

**Related functional requirements:** FR-47

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 1 | Normal: the full history is visible with every figure broken down | Duda has a mix of settled, owed, and failed payout obligations across one or more campaigns | she opens her payment history | she sees every obligation she has ever had, each showing gross, commission, net, and current status (owed, settled, failed), and can download a statement covering them. |
| 2 | Hard: obligations from different buyer contexts are attributed correctly | Duda has worked across campaigns run directly by a brand and campaigns run by an agency on a client's behalf (US-42, E6), with Aurora paying her directly in both cases | she views her history or downloads a statement | each line correctly attributes its campaign and buyer context without conflating an agency-billed campaign's figures with a directly brand-billed one, and her net payout per line is unaffected by which billing path funded it. |
| 3 | Failure: a request for data outside what belongs to her returns nothing exposing others | Duda requests a statement for a period or campaign where she has no payout record at all | she downloads or views it | the system returns an accurate, clearly empty result for that period or campaign, and at no point does it expose any other creator's financial figures as a side effect of an empty or malformed request. |

**Governing NFRs:** NFR-11, NFR-13, NFR-17, NFR-19, NFR-23, NFR-36

**Related epic dependency:** Renders the obligations created in US-35a and updated through US-35b/US-35c; surfaces the US-42 billing-path distinction without needing E9 (agency workspace) to exist yet, since Aurora's direct payout to Duda is unaffected by who is billed.

---

## US-36b -- Generate Tax Documentation for Creator Payouts *(sub-story of US-36, tagged US-36)*

**Persona:** Duda (nano creator)

**As** Duda, **I want** Aurora to generate the tax documentation my payouts require, **so that** I have what I need to account for my income without assembling it myself.

**Priority:** Should

**Related functional requirements:** FR-50

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 1 | Normal: documentation is generated for a settled payout | A payout obligation has settled (US-35b) in a jurisdiction Aurora operates in | the system processes the settlement | it generates the tax documentation that jurisdiction requires for that payout, and Duda can access or download it alongside the corresponding entry in her payment history (US-36a). |
| 2 | Hard: multiple payouts within the same tax period are each accounted for correctly | Duda has settled payouts from more than one campaign within the same tax period | documentation is generated for that period | each payout's documentation is correctly itemized and attributable to its own obligation, rather than the totals from separate payouts being merged into a single, less specific record where that would misstate what any one document covers. |
| 3 | Failure: documentation cannot be generated because required data is missing | Duda's profile is missing information the jurisdiction's documentation requires (for example, a tax registration identifier) | the system attempts to generate documentation for a settled payout | it does not silently omit the document or generate one with incomplete or incorrect data; it clearly flags to Duda what information is missing and what she needs to provide before the documentation can be produced. |

**Governing NFRs:** NFR-11, NFR-13, NFR-17, NFR-19, NFR-23, NFR-36

**Related epic dependency:** Depends on a settled obligation from US-35b; shares its display surface with US-36a.

---

## US-20 -- One Consolidated Invoice Covering the Whole Pool

**Persona:** Marina (brand media manager)

**As** Marina, **I want** one consolidated invoice covering the whole pool, **so that** finance processes a single document instead of hundreds.

**Priority:** Must

**Related functional requirements:** FR-48

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 1 | Normal: a single invoice covers the entire pool at the fixed quoted price | Marina has a confirmed campaign whose price was locked at quote time (US-07, E2, FR-18) and whose pool has run to a billable point | the campaign reaches that point | she receives exactly one invoice for the campaign, stating the fixed total price, and it is the only billing document finance has to process for that pool, regardless of how many creators were in it. |
| 2 | Hard: the pool's actual composition differed from the original guaranteed minimum | The campaign's final pool differed from its originally quoted guaranteed minimum, either because Aurora issued a refund or a revised guarantee for a shortfall (US-07, E2, FR-19) or because budget was reallocated toward better performers mid-campaign (US-10, E2, FR-23) | the invoice is generated | it still reflects a single, fixed total price with any refund or credit applied under FR-19 clearly itemized on that same document, rather than being split into a separate correction invoice or silently omitted. |
| 3 | Failure: an invoice is never issued before the pool's obligations can actually be stated | Someone attempts to trigger invoice generation for a campaign before its billable pool state is settled (for example, while creator opportunities are still pending acceptance) | the generation is attempted | the system refuses to issue the invoice at that point, states why, and never produces a premature or partial invoice that omits creators whose participation was not yet finalized. |

**Governing NFRs:** NFR-11, NFR-13, NFR-17, NFR-19, NFR-23, NFR-36

**Related epic dependency:** Reads the fixed price locked by US-07 (E2, FR-18) and any adjustment made under FR-19 or FR-23 (E2); independent of the creator-side obligations in US-35a to US-35c, since Marina's invoice and Duda's payout are two separate financial flows against the same campaign.

---

## US-42 -- Consolidated Per-Client Billing with Aurora Paying the Creators

**Persona:** Renata (agency partner)

**As** Renata, **I want** consolidated per-client billing with Aurora paying the creators, **so that** I stop reconciling payouts by hand.

**Priority:** Must

**Related functional requirements:** FR-49

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 1 | Normal: one invoice per client, Aurora settling creators directly | Renata runs a campaign on behalf of a specific client account (US-39, E9) | the campaign reaches a billable point | that client receives one consolidated invoice for its own campaigns, exactly as US-20 describes for a direct brand buyer, while Aurora settles every creator payout for that campaign directly with the creator (US-35a to US-35c), with no step requiring Renata to pass money through herself. |
| 2 | Hard: billing never bleeds across two different clients in the same workspace | Renata's agency workspace holds more than one client account, each running its own campaigns | invoices are generated for more than one client | each client's invoice contains only that client's own campaigns and figures; no line item, total, or creator-cost figure from one client ever appears on another client's invoice. |
| 3 | Failure: a billing dispute with a client never holds a creator's payout hostage | A client disputes or delays payment on its own consolidated invoice | the dispute or delay occurs | creator payouts already obligated under US-35a continue to be executed and settled within their own committed windows (US-35b) regardless of the state of Aurora's billing relationship with the agency's client; a creator's payment is never made contingent on whether the agency has been paid. |

**Governing NFRs:** NFR-11, NFR-13, NFR-17, NFR-19, NFR-23, NFR-36

**Related epic dependency:** Shares its creator-payout mechanics entirely with US-35a to US-35c; the "consolidated per-client" half of this story is the agency-specific analog of US-20 and depends on E9's client-account structure (US-38, US-39) to exist, which this document assumes but does not itself build.

---

## Open questions

1. **No numeric length is ever stated for the "committed payout window" (US-29/FR-43, US-35b/FR-45).** The business analysis names the pain being solved -- sixty days or more, with no visibility -- but no section of the PRD states the replacement target as a number of days, nor whether that window is one fixed platform-wide constant or configurable per campaign or creator. The acceptance criteria above treat "the committed window" as a known, already-displayed value at acceptance time, without assuming its length. This is a product decision that should be confirmed before the architecture document fixes a number into the data model.

2. **No commission rate or calculation formula is specified anywhere in sections 3 through 5 of the PRD.** FR-43 and FR-47 both require a commission to be displayed, and section 3.5's discussion of US-27 confirms Aurora absorbs rate variance as a margin question, but no percentage, tiering, or calculation method is stated. E3's own architecture uses illustrative example figures (for example, a 15% commission in its sample payloads) that are not themselves a requirement from this document's source material. This document does not assume a rate.

3. **No role is named for who may manually trigger a stalled payout, or approve/clear a failed one (US-35b, US-35c).** NFR-19 requires MFA for "roles that can approve payouts or change bank details," and NFR-11 explicitly allows a manual fallback trigger, but neither names which of FR-04's roles (brand owner, brand manager, brand analyst, creator, agency administrator, agency operator) carries that authority, nor whether it is an Aurora operations role outside FR-04's list entirely. The acceptance criteria above describe the fallback without assuming who executes it.

4. **Interaction between a paused or cancelled campaign (FR-21, E2) and an already-created, not-yet-settled payout obligation is not addressed.** FR-21 states that pausing or cancelling a campaign halts "all pending publications," but publication and payout are different events in the chain (FR-42 then FR-44), and the PRD does not state whether an obligation created before a pause or cancellation is honored, held, or affected at all by that campaign-level action. This document assumes an obligation already created under US-35a is unaffected, consistent with NFR-13's zero-tolerance framing for financial obligations, but this is an inference rather than a stated requirement.

5. **No format is specified for the downloadable statement in US-36a (FR-47).** FR-53, the brand-facing report export, explicitly names "a portable document and tabular format." FR-47 only says "downloadable" with no format named. This document does not assume PDF, CSV, or both.

6. **Tax documentation mechanics are left entirely open by FR-50 itself (US-36b).** The PRD states only that documentation must be generated "in each jurisdiction it operates in," without naming which jurisdictions beyond the implicit Brazilian default, which specific document types apply, or the timing relative to settlement. FR-50 is Should-priority, and this document records these mechanics as open rather than guessing a shape for a first release.

7. **The timing or cadence of the consolidated invoice is not stated for either US-20 or US-42 (FR-48, FR-49).** The PRD does not say whether an invoice is issued once at campaign completion, periodically during a long-running campaign, or on some other trigger tied to the campaign lifecycle states defined in FR-20 (E2). The acceptance criteria above describe the invoice's content and consolidation guarantee without assuming when it fires.

8. **Whether Aurora carries working-capital exposure paying creators ahead of collecting from brands or agency clients is not addressed by any functional requirement in this document's source material.** The business analysis names "creator payouts and financing float" as a named cost-structure concern, and US-42's scenario 3 above explicitly decouples a creator's payout from the state of Aurora's billing relationship with an agency's client, which is the only reading consistent with NFR-11's unconditional settlement promise -- but the PRD itself never states Aurora's own collection terms from brands or agencies, so this document cannot confirm whether that gap is a deliberate float the business absorbs or an unaddressed risk.

9. **NFR-26's explicit naming of FR-43 is not reflected in Table 15's E6 row (US-29).** As noted in the epic header, this document resolves the inconsistency by attaching NFR-26 to US-29 directly rather than treating the omission as authoritative, consistent with how E5's stories document handled the equivalent gap for FR-36. This is recorded here as well so the resolution is visible alongside the other open items rather than only in prose above.
