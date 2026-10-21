# E5 -- Briefing and Content Workflow

**Goal:** Replace vague briefings and silent review cycles with a structured brief and a review loop that always converges, so clarity for Duda becomes fewer rework cycles for Marina.

**Personas:** Duda (nano creator), Marina (brand media manager)

**Journey phases:** Duda briefing, creation and approval; Marina live campaign

**Strategic role (Table 1):** Serves both sides at once: clarity for Duda is fewer rework cycles for Marina.

**Governing NFRs (apply to every story in this epic, per Table 15 of the PRD):**

| NFR | Attribute | Target |
|---|---|---|
| NFR-04 | Performance | Interactive operations must stay responsive under normal load: read requests p95 ≤ 500 ms, write requests p95 ≤ 1,500 ms |
| NFR-25 | Usability | Creator-facing interfaces must work on the device creators actually use: fully functional from 360 px viewport width upward |
| NFR-32 | Observability | A single user action must be traceable across the whole system: structured logs carrying a correlation identifier end to end, retained 30 days |

These three sit alongside the eight NFRs that govern the whole platform without appearing in any epic's table (NFR-07, NFR-10, NFR-12, NFR-14, NFR-18, NFR-28, NFR-30, NFR-31), per section 5.3 of the PRD.

**A fourth NFR worth flagging explicitly for this epic:** Table 14's own "Constrains" column names **FR-36** (the structured briefing) as one of only four flows required to meet **NFR-26** (WCAG 2.2 level AA), alongside onboarding and payment. Table 15's E5 row does not list NFR-26 among this epic's governing NFRs, which is an inconsistency between the two tables rather than a deliberate exclusion -- FR-36 is explicitly named in NFR-26's own target. This document therefore attaches NFR-26 to US-18a and US-30 specifically (the two stories that build and render the briefing itself), in addition to the three epic-wide NFRs above, rather than silently dropping a requirement the PRD states elsewhere.

**Integration point this epic must account for, not rebuild:** E4 (Brand Safety, already built) shipped a minimal `content_submission` entity and an exported `BrandSafetyGateService` specifically so this epic would have something to extend rather than something to duplicate (ADR-0020; `docs/architecture/e4-brand-safety.md` section 3.6). Two consequences for the stories below:
- **US-32a's draft-acceptance behavior (FR-39) is expected to populate the same `content_submission` rows E4 already evaluates**, not a parallel table. E4's architecture explicitly anticipates this: "once E5 ships FR-39, its draft-submission code is expected to populate `content_submission` ... as part of accepting a draft."
- **US-34's publication-recording behavior (FR-42) is expected to call `BrandSafetyGateService.getGateStatus` before recording a publication, and `BrandSafetyGateService.recordPublication` immediately after**, reusing FR-33's enforcement point rather than re-implementing a safety check inside this epic. A thin HTTP wrapper (`POST /safety/submissions/:id/record-publication`) already exists for this exact purpose if E5's implementation needs it before a direct in-process call is wired up.

Neither point changes what Duda or Marina experience; both are named here so the acceptance criteria below can be built against the real integration surface instead of an assumed one.

---

## US-18a -- Compose a Structured Briefing *(sub-story of US-18, tagged US-18)*

**Persona:** Marina (brand media manager)

**As** Marina, **I want** to compose one structured briefing with explicit do's, don'ts, reference examples, a deliverable specification, and a deadline, **so that** no creator in my pool ever has to guess what I want.

**Priority:** Must

This is split out from US-18 because authoring a complete briefing and distributing it to a pool are two separable, separately testable behaviors (FR-36 versus FR-37). Keeping them as one story would hide the specific obligation FR-36 states -- that a briefing cannot be *issued* incomplete -- behind a single pass/fail on the whole send action.

**Related functional requirements:** FR-36 (shared with US-30, the creator-facing half of the same briefing)

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 1 | Normal: a complete briefing is composed and saved | Marina has a confirmed campaign (US-05, E2) ready to brief its creator pool | she fills in do's, don'ts, at least one reference example, a deliverable specification, and a deadline, and saves the briefing | the system stores it as a complete, issuable briefing containing every one of those fields, ready to be sent to the pool (US-18b). |
| 2 | Hard: a briefing is saved as work in progress with required fields still empty | Marina is drafting a briefing over more than one sitting and has not yet filled in every required field | she saves her progress without attempting to issue it | the system allows the partial save and clearly marks the briefing as incomplete, distinguishing a permitted draft state from the point where FR-36's obligation actually applies: the moment of issuing it to the pool, not every intermediate save. |
| 3 | Failure: an attempt to issue a briefing with a required field still empty | A briefing has one or more of do's, don'ts, examples, deliverable specification, or deadline left empty | Marina attempts to issue/distribute it | the system refuses to issue the briefing, states exactly which field or fields are missing, and sends nothing to any creator. A briefing is never distributed with a required field silently blank. |

**Governing NFRs:** NFR-04, NFR-25, NFR-32, and NFR-26 (WCAG 2.2 AA; see epic header note)

**Related epic dependency:** Shares its underlying content with US-30 (Duda's view of the same briefing). This story only covers composing and validating the briefing on Marina's side.

---

## US-18b -- Distribute a Briefing to the Entire Pool in One Action *(sub-story of US-18, tagged US-18)*

**Persona:** Marina (brand media manager)

**As** Marina, **I want** to send one structured briefing to the entire creator pool in a single action, **so that** coordination does not scale with creator count.

**Priority:** Must

**Related functional requirements:** FR-37

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 1 | Normal: one send action reaches every creator in the pool | Marina has a complete, issuable briefing (US-18a) for a campaign with an approved creator pool | she issues the briefing | every creator in the pool receives the identical briefing in that one action, with no need to send it creator by creator. |
| 2 | Hard: the pool includes creators approved at different times | The campaign's pool spans creators approved at different points during matching (US-13, E3), including some approved shortly before the briefing is sent, up to the pilot pool ceiling (NFR-06, 150 creators) | Marina sends the briefing | it reaches every creator currently in the pool at the moment of sending, including the most recently approved ones, not only those approved earliest. |
| 3 | Failure: the briefing cannot be delivered to one or more creators | One or more creators in the pool cannot be reached when the briefing is distributed (for example, a creator's account is in an invalid delivery state) | Marina sends the briefing | the system reports which specific creators the briefing failed to reach, rather than reporting the send as fully successful when it was not, and it never silently drops a failed delivery without telling her. |

**Governing NFRs:** NFR-04, NFR-25, NFR-32

**Related epic dependency:** Consumes the completed briefing from US-18a and the confirmed pool membership from E3 (US-11 to US-13).

---

## US-30 -- Receive a Briefing with Explicit Do's, Don'ts, and Examples

**Persona:** Duda (nano creator)

**As** Duda, **I want** a briefing with explicit do's, don'ts, and examples, **so that** I do not guess at what the brand wants.

**Priority:** Must

**Related functional requirements:** FR-36 (the creator-facing half of US-18a's obligation)

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 1 | Normal: the full briefing renders with nothing left to infer | Duda has an accepted opportunity (US-28, E3) for a campaign whose briefing has been issued (US-18b) | she opens the briefing | she sees explicit do's, don'ts, at least one reference example, the deliverable specification, and the deadline, all populated, with no field asking her to infer what is wanted. |
| 2 | Hard: a deliverable-specific detail is shown explicitly, not buried in general notes | The briefing's deliverable specification includes a detail more specific than the campaign's general description (for example, a required aspect ratio, a caption length limit, or a mandatory hashtag) | Duda views the briefing | that detail is shown as part of the deliverable specification itself, not left for her to infer from the campaign's general message or omitted entirely. |
| 3 | Failure: no active relationship to the campaign | Duda's opportunity for a campaign was declined or has expired (US-28, E3) before any briefing reached her | she attempts to view that campaign's briefing | the system does not show her a brand's briefing content for a campaign she has no active opportunity on, and states clearly that no briefing is available to her, rather than exposing private brand content without an active relationship. |

**Governing NFRs:** NFR-04, NFR-25, NFR-32, and NFR-26 (WCAG 2.2 AA; see epic header note)

**Related epic dependency:** Shares its underlying content with US-18a; depends on US-28 (E3) for the accepted opportunity that establishes Duda's right to see the briefing at all.

---

## US-31 -- Ask a Question About the Briefing and Get an Answer

**Persona:** Duda (nano creator)

**As** Duda, **I want** to ask a question about the briefing and get an answer, **so that** ambiguity is resolved before I produce anything.

**Priority:** Should

**Related functional requirements:** FR-38

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 1 | Normal: a question gets answered | Duda has received a briefing (US-30) that leaves something ambiguous to her | she posts a question on the briefing's Q&A thread | Marina (or a teammate with access to that campaign) sees the question, and once answered, Duda sees the answer on the same thread. |
| 2 | Hard: each creator's thread stays private, even though the briefing is shared | Two different creators in the same pool each ask a different question about the identical briefing | creator A asks a question | creator B does not see creator A's question or its answer, and vice versa. The Q&A thread is private between the asking creator and the buyer, even though the briefing content itself is shared across the whole pool. |
| 3 | Failure: a question goes unanswered | Duda has asked a question and nobody on the brand side has answered it within the campaign's active window | she checks back on the thread | her question is still visibly recorded as asked and unanswered, rather than disappearing or appearing as though it was never submitted. (The PRD states no response-time obligation for this thread; see Open questions.) |

**Governing NFRs:** NFR-04, NFR-25, NFR-32

**Related epic dependency:** Attaches to the same briefing produced by US-18a/US-30.

---

## US-32a -- Submit a Content Draft with Version Retention *(sub-story of US-32, tagged US-32)*

**Persona:** Duda (nano creator)

**As** Duda, **I want** to submit a content draft and have every version I send kept on record, **so that** nothing I submit is ever lost or silently overwritten.

**Priority:** Must

This is split out from US-32 because draft acceptance (FR-39) and deadline visibility with escalation (FR-41, US-32b) are two materially different behaviors: one is about what happens to the content submitted, the other is about the clock the reviewer is held to. Testing them as one story would hide a real integration dependency on E4's existing `content_submission` entity (see epic header note) inside a story whose stated benefit is actually about the review clock.

**Related functional requirements:** FR-39

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 1 | Normal: a first draft is accepted and recorded | Duda has an accepted opportunity and has read the campaign's briefing (US-30) | she submits a content draft | the system accepts it, records it as a submission tied to her opportunity and the campaign, and confirms the submission to her. |
| 2 | Hard: a resubmission after rejection retains both versions | Duda's first draft was rejected with a stated reason (US-19/US-33) | she submits a second draft responding to that feedback | the system retains both the original and the revised draft as separate, retrievable versions, rather than overwriting the first one, so that what changed between versions remains visible to Marina, Duda, and an auditor alike. |
| 3 | Failure: a draft is submitted with no active opportunity behind it | Duda attempts to submit a draft against a campaign where she has no accepted opportunity, or where the campaign has since been paused or cancelled (US-09, E2) | she submits | the system refuses the submission, states why (no active opportunity or the campaign is not running), and does not create a submission record that would misleadingly suggest a draft is in play for a job that no longer exists. |

**Governing NFRs:** NFR-04, NFR-25, NFR-32

**Integration note:** This story's accepted drafts are the same submissions E4's `BrandSafetyGateService` evaluates and gates (FR-33, US-16). This epic's acceptance/version-history behavior is expected to build on the `content_submission` rows E4 already creates, not define a second, parallel representation of "content submitted for a campaign" (ADR-0020). ADR-0020 names one specific seam this story must resolve at the architecture stage: resubmitting content after a `revision_requested` decision currently creates a new `content_submission` row with no link back to the one it supersedes. This stories document does not resolve that linkage itself; see Open questions.

---

## US-32b -- See the Review Deadline and Have It Escalate on Breach *(sub-story of US-32, tagged US-32)*

**Persona:** Duda (nano creator)

**As** Duda, **I want** to see when my draft's review will finish and know that a missed deadline does not just vanish into silence, **so that** I am never left waiting on a process I cannot see into.

**Priority:** Must

**Related functional requirements:** FR-41

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 1 | Normal: a stated deadline is visible at submission | Duda has submitted a draft (US-32a) | she views her submission | she sees a stated review deadline (the date and time by which a decision is expected), not merely a "pending" status with no timeframe. |
| 2 | Hard: the deadline is breached without a decision | A draft's review deadline passes with no approval or rejection recorded (US-19) | the deadline is breached | the system escalates the review rather than leaving the draft silently pending with no visible change, and Duda's own view of her submission reflects that it has been escalated. |
| 3 | Failure: the escalation target or outcome is itself unclear | A review deadline has been breached and the specific escalation destination is not resolvable (the PRD does not name who or what receives the escalation; see Open questions) | the breach occurs | the submission is never silently left as if nothing happened: at minimum, it is visibly marked overdue and escalated in a way both Duda and Marina's team can see, even where the precise notification target is not fully specified by the requirements. |

**Governing NFRs:** NFR-04, NFR-25, NFR-32

**Related epic dependency:** Builds on the submission created in US-32a.

---

## US-19 -- Approve or Reject a Draft with a Stated Reason

**Persona:** Marina (brand media manager)

**As** Marina, **I want** to approve or reject a draft with a stated reason, **so that** revisions converge instead of looping.

**Priority:** Must

**Related functional requirements:** FR-40 (shared with US-33, the creator-facing half of the same obligation)

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 1 | Normal: a draft is approved | Marina (or a teammate with access to the campaign) is reviewing Duda's submitted draft (US-32a) | she approves it | the system records the approval and makes clear to Duda that her draft has moved to an approved state, with no reason required for an approval. |
| 2 | Hard: a specific draft version is rejected with a reason tied to that version | Duda has submitted more than one draft version for the same opportunity (US-32a) | Marina rejects one specific version and provides a reason | the system stores that reason attached unambiguously to the exact version it applies to, so a later reader can never confuse which version a given rejection reason was about. |
| 3 | Failure: an attempt to reject without a reason | Marina attempts to reject a draft | she submits the rejection with no reason provided | the system refuses to finalize the rejection and requires a reason before it is recorded, so a draft is never left in a "rejected, reason unknown" state. |

**Governing NFRs:** NFR-04, NFR-25, NFR-32

**Related epic dependency:** Acts on the submission from US-32a; its stated-reason obligation is the same FR-40 obligation E4's US-17 (flagged-content review) explicitly reuses rather than duplicates.

---

## US-33 -- Receive a Stated Reason Whenever Content Is Rejected

**Persona:** Duda (nano creator)

**As** Duda, **I want** a stated reason whenever my content is rejected, **so that** I can fix it instead of guessing.

**Priority:** Must

**Related functional requirements:** FR-40

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 1 | Normal: the stated reason is visible on the rejected draft | One of Duda's drafts has been rejected with a stated reason (US-19) | she checks her submission | she sees that specific reason displayed plainly, not just a "rejected" status with no explanation attached. |
| 2 | Hard: the reason is attributed to the correct version among several | Duda has submitted multiple draft versions over time for the same opportunity (US-32a), and an earlier version was rejected while a later version is still pending | she views her submission history | she can see exactly which version each rejection reason applies to, rather than one reason floating ambiguously across all of her versions. |
| 3 | Failure: a rejection can never exist without its reason | A draft is being rejected by Marina (US-19) | the rejection is recorded | the reason is recorded atomically with the rejection decision, in the same operation, so a rejection can never appear in Duda's view as final or actionable without a reason already attached to it. |

**Governing NFRs:** NFR-04, NFR-25, NFR-32

**Related epic dependency:** Receives the decision and reason recorded by US-19; depends on US-32a's version model to attribute a reason to the correct draft.

---

## US-34 -- Confirm Publication by Submitting the Live Post Link

**Persona:** Duda (nano creator)

**As** Duda, **I want** to confirm publication by submitting the live post link, **so that** my delivery is recorded and my payment is triggered.

**Priority:** Must

**Related functional requirements:** FR-42

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 1 | Normal: a cleared, matching post is confirmed as published | Duda's draft has been approved (US-19) and its content has cleared the brand safety gate (US-16/FR-33, E4; `BrandSafetyGateService.getGateStatus` returns `cleared: true`) | she submits the live post's URL | the system validates that the link resolves and corresponds to the approved content, records the publication tied to that exact approved version, and calls `BrandSafetyGateService.recordPublication` so brand-safety monitoring can begin where applicable (US-16b, E4). |
| 2 | Hard: the live post does not match the approved content | Duda submits a live post link whose actual content (caption, on-screen text, or audio) differs from the version that was approved and cleared | the system checks the submitted link against the approved content | it does not record the link as a confirmed publication: detecting that the link's content does not correspond to the approved version, it refuses to treat the submission as a valid publication confirmation and states why. |
| 3 | Failure: the link does not resolve, or the content was never cleared | Duda submits a link that does not resolve (dead link, private post, wrong URL), or attempts to confirm publication before her content has cleared the brand safety gate (`cleared: false`) | she attempts to confirm publication | the system refuses to record the publication, states the specific reason (link unreachable, or content not yet cleared), and does not create any payout obligation (FR-44, E6) off the back of an unconfirmed publication. |

**Governing NFRs:** NFR-04, NFR-25, NFR-32

**Integration note:** This story is the FR-42 completion hook E4's architecture names explicitly (`docs/architecture/e4-brand-safety.md` section 3.6): E5's publication-recording code must call `BrandSafetyGateService.getGateStatus` before recording a publication and refuse when `cleared: false`, and must call `BrandSafetyGateService.recordPublication` immediately after a successful recording. Neither method is reimplemented here; a future E5 architecture should treat `BrandSafetyGateService` as a given interface, consistent with E4's own framing of its place in this handoff.

**Related epic dependency:** Depends on US-19 (approval) and, through it, on the brand safety gate established in E4 (US-16, US-17). Feeds FR-44 (payout obligation creation), which belongs to E6 and is out of this epic's scope.

---

## Open questions

1. **No stated response-time obligation for the briefing Q&A thread (US-31, FR-38).** FR-41 gives draft review an explicit deadline and an escalation on breach. FR-38 gives the briefing Q&A thread no equivalent target: the PRD does not say how quickly a creator's question must be answered, or what happens if it never is. The acceptance criteria above only guarantee the question stays visibly recorded as unanswered; nothing further is specified or assumed.

2. **No named escalation target for a breached review deadline (US-32b, FR-41).** FR-41 states the system "shall escalate the review" when a deadline is breached, but does not say to whom: a specific reviewer, a supervisor, an operations queue, or simply a more prominent flag on the same reviewer's own view. The acceptance criteria above guarantee visible escalation without assuming a specific destination, pending a product decision.

3. **No stated limit on draft resubmission, and no specified version-linking model (US-32a, FR-39).** FR-39 requires every submitted version to be retained but does not state whether there is a cap on how many times a creator may resubmit, nor what happens if a campaign's deadline passes before an acceptable draft is reached. It also does not specify how a resubmitted draft should be linked to the version it supersedes for display purposes (for example, whether Marina or Duda should see "version 2 of 3, superseding version 1" or simply a flat list of submissions in order). ADR-0020 already names this exact linkage as an unresolved seam between E4's minimal `content_submission` entity and E5's eventual version history; this document does not resolve it at the product level either, and records it here rather than assuming a shape.

4. **Format of a "reference example" in a briefing is unspecified (US-18a/US-30, FR-36).** FR-36 requires "reference examples" as one of the briefing's mandatory fields, but the PRD does not state whether an example is a link, an uploaded media asset, free text description, or any combination of those. The acceptance criteria above treat "at least one reference example" as satisfied by any non-empty value, without assuming a specific format.

5. **Who on the brand side may answer a Q&A thread, or clear a flagged draft, is not role-restricted in the PRD (US-19, US-31, FR-38, FR-40).** FR-04 defines distinct brand-side roles (owner, manager, analyst), but neither FR-38 nor FR-40 states which of these roles may post an answer or make an approve/reject decision. The acceptance criteria above are written persona-neutral ("Marina," "a teammate with access to the campaign") without assuming a role boundary, consistent with how E4's stories document left the equivalent question open for its own review-queue decision (E4 Open question 5).

6. **Effect of pausing or cancelling a campaign on an in-flight briefing, Q&A thread, or pending draft review is not addressed (US-18 through US-33, interacting with FR-21, E2).** FR-21 states that pausing or cancelling a campaign halts "all pending publications," but does not state what happens to a briefing already distributed, an open Q&A thread, or a draft sitting in review when the campaign it belongs to is paused or cancelled mid-flight. This document does not assume a behavior for that interaction and records it as open.

7. **Tolerance for "corresponds to the approved content" in the publication-link check is unspecified (US-34, FR-42).** FR-42 requires validating that the live link "corresponds to the approved content," but the PRD does not state whether any variance is tolerated (for example, a platform-added watermark, a trivial whitespace difference, or a cross-posted caption truncated by a platform's character limit) or whether any detectable difference at all must block confirmation. The acceptance criteria above treat any content difference as a block, which is the only reading consistent with FR-33's zero-tolerance framing in E4, but the specific tolerance threshold should be confirmed with product before build.

8. **The exact mapping between E5's draft/version/review workflow and E4's existing `content_submission` rows is an architecture decision, not a resolved product requirement.** This document assumes, consistent with ADR-0020 and `docs/architecture/e4-brand-safety.md`, that US-32a's draft acceptance is built on top of the `content_submission` entity E4 already created rather than a separate parallel table, and that US-34's publication confirmation calls into `BrandSafetyGateService` rather than re-implementing the gate. The acceptance criteria above are written to hold under that assumption, but the specific implementation (for example, exactly how a creator-portal draft becomes the row the safety check evaluates) is left to the E5 architecture document, per E4's own framing of this handoff.
