# E4 -- Brand Safety

**Goal:** Catch off-message content before it goes live by checking the actual message, not just the format, so Marina never discovers a brand safety problem after publication.

**Personas:** Marina (brand media manager)

**Journey phases:** Marina live campaign

**Strategic role (Table 1):** Table stakes. Message-level checking before publication, not format-level checking after.

**Governing NFRs (apply to every story in this epic):**

| NFR | Attribute | Target |
|---|---|---|
| NFR-03 | Performance | Brand safety verdicts must return fast enough not to become the bottleneck in the review cycle: p95 ≤ 5 minutes per submission |
| NFR-29 | Modifiability | The brand safety model should be replaceable as it improves, without disturbing the money path: replacing it should not require changes to campaign or payment code, nor a database migration |
| NFR-34 | Cost efficiency | Cost must not scale linearly with pool size, since a safety check runs per creator per submission; designed for at pilot scale (up to 150 creators), formally verified once pools approach 5,000 |

These three sit alongside the eight NFRs that govern the whole platform without appearing in any epic's table (NFR-07, NFR-10, NFR-12, NFR-14, NFR-18, NFR-28, NFR-30, NFR-31), per section 5.3 of the PRD.

---

## US-15 -- Define Brand Safety Rules and Prohibited Topics

**Persona:** Marina (brand media manager)

**As** Marina, **I want** to define brand safety rules and prohibited topics, **so that** safety reflects my brand rather than a generic default.

**Priority:** Must

**Related functional requirements:** FR-31 (and FR-03, shared with E1, for the brand-profile defaults this ruleset inherits from)

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 1 | Normal: brand-level ruleset defined and inherited by every new campaign | Marina has an active brand profile (US-03, E1) | she defines a safety ruleset covering prohibited topics, restricted language, and competitor mentions at the brand level | the system stores the ruleset against her brand profile and applies it as the default safety ruleset to every new campaign she creates, with no extra step required per campaign. |
| 2 | Hard: campaign-specific override differs from the brand default | Marina has a brand-level ruleset already in place, and she is setting up one specific campaign that legitimately needs a different rule (for example, a co-branded campaign where a usual "competitor" is actually the partner) | she overrides one or more rules at the campaign level | the system applies the override to that campaign only, leaves the brand-level default and every other campaign untouched, and makes clear in the campaign's safety settings that this campaign is running on an override rather than the inherited default. |
| 3 | Failure: malformed or unsupported rule submitted | Marina attempts to save a rule the system cannot evaluate, such as a restricted-language pattern it cannot parse, or a competitor reference it cannot resolve | she submits the ruleset change | the system rejects the specific invalid rule, states why it could not be saved, and leaves the previously valid ruleset in effect unchanged. It never saves a partially invalid ruleset or silently drops the unparseable rule while accepting the rest without telling her. |

**Governing NFRs:** NFR-03, NFR-29, NFR-34

**Related epic dependency:** Shares storage with the brand profile defaults from US-03 (E1, FR-03); this story specifies the safety-specific ruleset and its per-campaign override, not the brand profile as a whole.

---

## US-16 -- Message-Level Check Before Publication

**Persona:** Marina (brand media manager)

**As** Marina, **I want** every submission checked at the message level before publication, **so that** off-message content never goes live.

**Priority:** Must

**Related functional requirements:** FR-32, FR-33

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 1 | Normal: a compliant submission passes and clears for publication | A creator has submitted a content draft (US-32, E5) against a campaign with an active safety ruleset (US-15) | the system analyzes the submission's caption text, on-screen text, and spoken audio against that ruleset | it returns a pass verdict within 5 minutes at p95 (NFR-03), and the submission becomes eligible to move forward in the approval and publication flow (E5) without any safety-related block. |
| 2 | Hard: a violation surfaces in only one of the three checked channels | A submission's caption text is clean, but its spoken audio contains a prohibited-topic reference, or its on-screen text contradicts a restricted-language rule | the system evaluates all three channels (caption, on-screen text, audio) rather than caption alone | the submission is flagged as failing the safety check, citing the specific channel and rule that triggered it, even though the other two channels passed. A pass in two of three channels never produces an overall pass. |
| 3 | Failure: an attempt to mark content as published without a passing safety verdict | A submission is still pending its safety verdict, or has already been flagged, and has not received a pass | anyone (Marina, a teammate, or an automated step in the workflow) attempts to mark that content as published (FR-42, E5) | the system refuses the publication action outright, states that the content has not passed the brand safety check, and does not record a publication event. The gate cannot be bypassed from the publication side regardless of who or what initiates the attempt. |

**Governing NFRs:** NFR-03, NFR-29, NFR-34

**Related epic dependency:** Sits on the cycle between M6 (Content Workflow) and M5 (Brand Safety) described in Figure 5 of the PRD: content enters this check from the workflow in E5 and returns to it with a verdict, which is what makes this a gate before publication rather than an audit after it. FR-33's refusal is the enforcement point that FR-42 (publication recording, E5) must respect.

**Note on failure mode when the safety engine itself cannot respond in time:** see US-16's sibling scenario under "Open questions" below; the PRD does not state what happens to a submission when the check itself times out or the engine is unavailable, as opposed to when it returns a fail verdict.

---

## US-16b -- Monitor Published Content for Deviations *(sub-story of US-16, tagged US-16)*

**Persona:** Marina (brand media manager)

**As** Marina, **I want** published content to keep being watched for later edits or removal, **so that** an approved message does not quietly change after it goes live.

**Priority:** Could

This is split out from US-16 because it is a materially different capability: US-16 gates content before it is first published, while this story monitors content that has already cleared that gate. FR-35 carries its own (lower) priority in the PRD's M5 table, which is the other reason to keep it a separate, smaller unit rather than folding it into the Must-priority publication gate.

**Related functional requirements:** FR-35

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 1 | Normal: a published post remains unchanged | A creator's post has been recorded as published (FR-42) and matches the approved content | the system periodically checks the live link | it finds no deviation and records the post as still matching its approved version, with no action required from Marina. |
| 2 | Hard: the creator edits the live post after publication | A published post is later edited by the creator (for example, the caption is changed after the fact) | the system's periodic check runs | it detects that the live content no longer matches the approved version, flags the deviation to Marina, and states what changed rather than simply noting "a difference exists." |
| 3 | Failure: the live link becomes unreachable | A published post's link returns an error, or the post has been deleted or made private | the system's periodic check runs | it distinguishes "removed or unreachable" from "edited," flags it as such to Marina, and does not treat a removed post as if it were still compliant simply because no content is left to re-check. |

**Governing NFRs:** NFR-03, NFR-29, NFR-34

**Related epic dependency:** Depends on FR-42 (publication recording, E5) having already recorded the approved version to monitor against.

---

## US-17 -- Flagged Content Routed to a Human Decision

**Persona:** Marina (brand media manager)

**As** Marina, **I want** flagged content routed to me for a human decision, **so that** an automated check never silently blocks legitimate content.

**Priority:** Must

**Related functional requirements:** FR-34

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 1 | Normal: a single flagged submission reaches the review queue | A submission fails the safety check under US-16 by triggering exactly one rule | the system processes that result | it routes the submission to a human review queue, citing the specific rule triggered, rather than rejecting the content automatically. Marina can then approve it, reject it with a stated reason (FR-40, E5), or request a revision. |
| 2 | Hard: a submission triggers multiple rules at once | A submission fails the safety check by triggering more than one rule simultaneously (for example, both a prohibited topic and a competitor mention) | the system routes it to the review queue | the queue entry lists every rule triggered, not just the first one found, so Marina's decision is informed by the full picture rather than a partial one. |
| 3 | Failure: the review queue is unreachable when Marina tries to act on it | The review queue service is degraded or temporarily unavailable when Marina opens it | she attempts to view or decide on a flagged item | the system shows a clear error rather than a blank or misleadingly empty queue, and the flagged content remains in its flagged, unpublished state (per US-16, scenario 3) until she can actually review it. It is never automatically rejected or automatically published as a side effect of the queue being unreachable. |

**Governing NFRs:** NFR-03, NFR-29, NFR-34

**Related epic dependency:** Consumes the verdict and triggered rule from US-16; its approve/reject-with-reason mechanics reuse the stated-reason obligation specified fully in E5 (US-19, US-33, FR-40).

---

## Open questions

1. **Ruleset conflict resolution between brand-level and campaign-level rules (US-15).** FR-31 states the campaign-level ruleset is "overridable," but the PRD does not say whether a campaign override replaces the brand default wholesale, or merges with it rule by rule (and if it merges, which rule wins on a direct conflict). The acceptance criteria above assume a full override of the specific rule in conflict, but this needs a product decision, not an assumption carried into the build.

2. **Ruleset changes mid-campaign and already-submitted content (US-15).** It is unspecified whether changing a brand's or campaign's safety ruleset after some content has already been submitted and passed under the old ruleset triggers a re-check of that content, or whether only new submissions are evaluated against the updated rules. This matters for consistency: a brand could tighten its rules mid-campaign and have already-approved content fall out of compliance with no mechanism to catch it.

3. **Timeout or unavailability of the safety check itself, as distinct from a fail verdict (US-16).** FR-33 is explicit about refusing publication when content "has not passed" the check, and NFR-03 sets a 5-minute p95 target for a verdict, but the PRD does not state what happens when the check cannot complete at all within a reasonable window (engine down, timeout, dependency failure). The acceptance criteria above treat "pending/no verdict" the same as "flagged" for the purpose of blocking publication, since that is the only reading consistent with FR-33's zero-tolerance framing, but an explicit fallback or escalation path for a stuck check is not described anywhere in the requirements and should be confirmed with product before build.

4. **No stated service-level target for human review itself (US-17).** FR-41 gives ordinary draft review an explicit deadline and an escalation on breach (E5, US-32). FR-34 gives brand safety review no equivalent deadline or escalation, so there is no stated bound on how long a flagged item can sit in Marina's queue, and no defined behavior if she never acts on it. The acceptance criteria above only guarantee the item is never auto-rejected or auto-published while unreviewed; whether it should also escalate after some period is not specified in the PRD and is recorded here rather than invented.

5. **Role restriction on who may clear a flag (US-17).** FR-04 defines distinct roles (brand owner, brand manager, brand analyst, and others), but the PRD does not state which of these roles is authorized to approve or reject a flagged item. The acceptance criteria above are written persona-neutral ("Marina") without assuming a specific role boundary, pending a product decision.

6. **Scope of "message level" analysis beyond text and audio (US-16).** FR-32 scopes the check explicitly to "caption text, on-screen text, and spoken audio." It does not mention purely visual content with no accompanying text or speech (for example, an image carrying a prohibited logo or imagery with no caption at all). This may be a deliberate scope limit or a gap in the requirement; it is recorded here rather than assumed to be covered.

7. **Monitoring cadence, notification, and available actions for post-publication deviations (US-16b).** FR-35 establishes that the system "shall monitor" published links and "flag deviations," but gives no check frequency, no statement of who besides Marina is notified, and no description of what action is available once a deviation is flagged (for example, whether Aurora can require the creator to revert or take down the post, or whether this is purely informational). Since FR-35 is a Could-priority requirement, these details are recorded as open rather than guessed, and may reasonably be deferred past the first release.
