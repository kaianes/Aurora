# E9 -- Agency Multi-Client Operations

**Goal:** Let an agency run many clients from one workspace without rebuilding its process per client, so that growing Renata's roster does not grow her overhead proportionally.

**Personas:** Renata (agency partner)

**Journey phases:** Renata workspace setup, operation, and reporting

**Strategic role (Table 1):** Opens agencies as a distribution channel and infrastructure customer.

**Governing NFRs (apply to every story in this epic, per Table 15 of the PRD):**

| NFR | Attribute | Target |
|---|---|---|
| NFR-09 | Scalability | Up to 10 client accounts per agency workspace (pilot plan limit) |
| NFR-16 | Authorization | **[Promise holds]** 100% of requests authorized server-side; zero successful cross-tenant reads; every denied attempt logged |
| NFR-17 | Accountability | Immutable audit log covering authentication, authorization changes, and all financial events, retained 5 years |

These three sit alongside the eight NFRs that govern the whole platform without appearing in any epic's table (NFR-07, NFR-10, NFR-12, NFR-14, NFR-18, NFR-28, NFR-30, NFR-31), per section 5.3 of the PRD.

---

## Before the stories: what this epic inherits already built, and what genuinely remains

E9 is the last epic written, and three prior epics explicitly built agency infrastructure ahead of it, on the precedent set by ADR-0013 and ADR-0020 (take the smallest slice of a later epic's scope rather than blocking on it). This section states plainly what already exists in production code and architecture documents, checked directly against the codebase rather than assumed from the PRD's own table, so this document does not re-specify work that is done and does not silently skip work that remains.

**Already fully built, confirmed against the codebase:**

- **FR-06 (workspace types) and FR-07 (client-account isolation).** `backend/src/database/entities/workspace.entity.ts` (`type: brand | agency`, `maxClientAccounts`), `account.entity.ts` (`workspaceId`), and the `account_id`-keyed RLS policy from E1 (`docs/architecture/e1-access-onboarding.md` section 2.5) already implement the full tenancy primitive US-38 asks for. Every epic from E2 onward already reads and writes `account_id` through this same mechanism with no agency-specific code path (E6's ADR-0040 states this explicitly for `invoice`).
- **FR-58 (per-client operator permissions, US-45) and FR-59 (client onboarding reusing agency configuration, US-47).** `backend/src/agency/agency.service.ts` and `agency.controller.ts` already ship `POST /agency/clients` (client onboarding, including template-copy intent and branding-defaults inheritance), `GET /agency/clients` (scoped listing), and `POST`/`DELETE /agency/clients/:clientId/operators` (grant/revoke per-client access via the `operator_client_access` join table). US-47 is E1's own story (Table 4 and Table 15 both assign it to E1, not E9) and is already fully specified in `docs/epics/e1-access-onboarding/stories.md`; it is not re-specified here.
- **FR-24 (campaign run on behalf of a client, US-39's underlying mechanism).** `backend/src/common/guards/roles.guard.ts` resolves `currentAccountId` from the `X-Account-Id` header through `AccountAccessService.resolveAccess`, which already covers "the agency-acting-on-a-client-account case, where no direct Membership row exists on the client account itself" (the guard's own code comment). Every campaign-scoped endpoint in `campaign.controller.ts` already reads this resolved `currentAccountId` generically, and `campaign.service.ts` already stores it as the campaign's `account_id`. This is the same mechanism ADR-0048 confirmed is already load-bearing for E6 and E7's agency-scoped endpoints.
- **FR-49 (consolidated per-client billing, US-42).** Fully built in E6. ADR-0040 establishes that `invoice`/`invoice_line_item` serve both direct-brand (US-20) and agency-client (US-42) billing identically, with no agency-specific schema, relying entirely on FR-07's existing account isolation. US-42 is E6's own story (Table 4 and Table 15 both assign it to E6) and is specified in `docs/epics/e6-payments-financial-transparency/stories.md`; it is not re-specified here.
- **FR-55 (per-client branded reports, US-43) and FR-56 (cross-client comparison, US-46), except branding configuration itself.** Fully built in E7. ADR-0048 and `docs/architecture/e7-analytics-reporting.md` establish that both reports read E1's existing `workspace`/`account`/`operator_client_access` primitives with no new client-account entity, plus a narrow RLS escape hatch (`app.agency_cross_client_read`) for the cross-client read. US-43 and US-46 are E7's own stories (Table 4 and Table 15 both assign them to E7) and are specified in `docs/epics/e7-analytics-reporting/stories.md`; they are not re-specified here.

**What E7 built *ahead of* E9, explicitly sized to be extended, not replaced (ADR-0048):** a minimal `agency_branding_profile` table (`workspace_id`, `logo_url`, `primary_color_hex`, `secondary_color_hex`) and a configuration form at `/agency/branding`, used **only** to theme the per-client report PDF/CSV (US-43). It carries no domain field and is read by nothing except the report renderer. ADR-0048 states this explicitly: "no domain field... no client-facing white-label surface configuration... this table lives in the existing `agency` module, additively... When E9 ships, it extends this table... rather than replacing it." FR-57's full scope -- domain, and branding applied to "client-facing surfaces" generally, not just reports -- is genuinely unbuilt, and is this epic's to finish (US-44, below).

**What genuinely remains, confirmed against the codebase:**

- **US-41 (cross-client template reuse).** E2 built `campaign_template` scoped to a single account only, and its own stories document states explicitly: "Agency cross-client sharing (US-41) is out of scope here per the stories document and belongs to E9" (ADR-0010). E1's `POST /agency/clients` already accepts a `copy_templates_from` parameter, but `agency.service.ts`'s own code comment shows it was never wired up after E2 shipped `campaign_template`: `// Template copying would happen here in future epics / For E1, we acknowledge the parameter but no campaign templates exist yet. templatesCopied = 0;`. This is a genuine, confirmed gap.
- **US-44 (white-label the client-facing surface, full FR-57 scope).** As stated above: no domain field exists anywhere, and branding is applied to nothing but the report renderer. This is a genuine, confirmed gap.
- **US-39's user-facing workflow.** The authorization mechanism is built (FR-24, above), but no frontend route anywhere in any architecture document gives Renata an explicit "act on behalf of client X" selector or shows a campaign's client attribution back to her. E2's frontend route map (`/app/campaigns`, `/app/campaigns/new`, `/app/campaigns/:id`) is written brand-generic, with no client-context affordance named. This is a genuine, confirmed gap, narrower than it first appears because the hard tenancy guarantee underneath it is already built and already tested by every prior epic.
- **FR-60 (audit log of actions within a client account, attributable to the acting user), for US-38 and US-45.** The write path is fully built and already in use everywhere (`backend/src/audit/audit.service.ts`, called by `client_account.created`, `operator_access.granted`, `operator_access.revoked`, `authorization.denied`, and every other epic's own events). But no read path exists: there is no `audit.controller.ts` anywhere in the codebase, and no epic's frontend route map names a screen for viewing it. "Maintain an audit log... attributable to the acting user" is satisfied at the storage level but not at the level Renata could ever actually use it. This is a genuine, confirmed gap, addressed below as a shared addendum to US-38 and US-45.

The five stories below are exactly the five Table 15 traces to E9: US-38, US-39, US-41, US-44, US-45. Each section states plainly what is already built versus what remains, then gives full Given/When/Then acceptance criteria for the complete, user-observable behavior, so QA can test the whole promise regardless of which epic built which part of it.

---

## US-38 -- One Workspace Holding Several Client Accounts With Isolated Data

**Status: already fully implemented, by E1.** FR-06 and FR-07 are shipped production code (`workspace.entity.ts`, `account.entity.ts`, the `account_id`-keyed RLS policy, `agency.service.ts`'s `listClients`/`createClient`). No new backend or frontend work is specified by this story. The acceptance criteria below are reproduced in full so the promise remains testable and traceable from this epic's own document, not only from E1's.

**Persona:** Renata (agency partner)

**As** Renata, **I want** one workspace holding several client accounts with isolated data, **so that** I stop managing clients in separate spreadsheets.

**Priority:** Must

**Related functional requirements:** FR-06, FR-07

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 1 | Normal: an agency workspace holds multiple isolated client accounts | Renata's agency workspace has three client accounts, each with its own campaigns, creators, content, and invoices | she views her client list or opens any one client's data | she sees exactly that client's campaigns, creators, content, and financial records, with nothing from the other two clients visible in the same view. |
| 2 | Hard: an operator switches context between two clients in the same session | Renata (or an agency operator with access to both) views Client A's data, then switches to Client B's data in the same login session | the switch happens | no data from Client A persists into the Client B view (no cached list, no stale total, no creator carried over), and the reverse holds when switching back. |
| 3 | Failure: an attempt to read one client's data while scoped to another | A request is made with a client account ID that is not the one the caller's session or token context currently resolves to, whether through the UI or a direct API call | the system evaluates the request | it denies access, returns an authorization error, and logs the denied attempt (NFR-16). Zero rows from the unauthorized client are returned under any condition. |

**Governing NFRs:** NFR-09, NFR-16, NFR-17

**Built by:** E1 (`docs/architecture/e1-access-onboarding.md` sections 2.1-2.5; `backend/src/agency/agency.service.ts`).

---

## US-39 -- Run Campaigns on Behalf of a Specific Client

**Status: the authorization mechanism is already fully built (FR-24, by E1, reused unmodified by every campaign-scoped endpoint across E2-E6); the user-facing workflow -- an explicit client-context selector and visible client attribution on the campaign itself -- is not built anywhere and is this epic's genuine scope.**

**Persona:** Renata (agency partner)

**As** Renata, **I want** to run campaigns on behalf of a specific client, **so that** every campaign is attributed to the right account.

**Priority:** Must

**Related functional requirements:** FR-24

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 1 | Normal: a campaign is created under an explicitly selected client | Renata is logged into her agency workspace with access to more than one client account | she explicitly selects which client she is acting on behalf of, then defines and creates a campaign (US-05, E2) | the campaign is created with that client's account recorded as its owner, and every subsequent view of that campaign (list, detail, dashboard) clearly and persistently shows which client it belongs to, so neither she nor a teammate can mistake it for another client's work. |
| 2 | Hard: Renata manages several clients in the same working session and switches between them | Renata has created or is viewing campaigns for Client A, then switches her active client context to Client B | she creates a new campaign or views an existing one under Client B | the new campaign is attributed to Client B, and every list, detail, or dashboard view she opens under Client B's context shows only Client B's campaigns; nothing from Client A's context carries over by the switch itself. |
| 3 | Failure: an attempt to create a campaign for a client Renata (or her operator) does not have access to | An agency operator has not been granted `operator_client_access` for a given client account (US-45), or Renata attempts to select a client account outside her own agency workspace | she attempts to select that client and create a campaign | the system refuses the action before any campaign is created, states that she does not have access to that client, and logs the denied attempt (NFR-16). No campaign is ever created under a client account the acting user cannot reach. |

**Governing NFRs:** NFR-09, NFR-16, NFR-17

**What is already built:** `RolesGuard` + `AccountAccessService.resolveAccess` (`backend/src/common/guards/roles.guard.ts`) already resolve and enforce exactly which client account a request may act against, covering scenario 3 completely today for any direct API call. `campaign.service.ts` already stores the resolved account as the campaign's owner, covering the data half of scenario 1.

**What remains:** a frontend client-context selector (so Renata explicitly picks which client she is acting for, rather than the system silently inferring it from whatever `X-Account-Id` a request happens to carry), and a persistent, visible client-attribution label on campaign list/detail/dashboard views within the agency workspace -- neither exists in any route named by E2's or E7's frontend route maps today.

---

## US-41 -- Apply Reusable Templates Across Clients

**Status: partially built.** E2 built `campaign_template`, scoped to a single account only, and its own architecture document explicitly defers cross-client sharing to E9 (ADR-0010). E1's client-onboarding endpoint accepts a `copy_templates_from` parameter but never actually copies anything (`templatesCopied` is hardcoded to `0`, with a comment stating the parameter predates `campaign_template`'s existence). Both the at-onboarding-time copy and an ongoing, after-the-fact reuse capability are genuinely unbuilt.

**Persona:** Renata (agency partner)

**As** Renata, **I want** to apply reusable templates across clients, **so that** I do not rebuild the same structure for every account.

**Priority:** Should

**Related functional requirements:** FR-22

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 1 | Normal: a template is copied into a new client at onboarding time | Renata has a `campaign_template` saved under an existing client account (US-08, E2), and onboards a new client, naming the existing one as the template source | the new client account is created | the new client's account receives its own copy of that template's structure (audience, message, deliverable formats, timeline shape), with no budget, pool, creator list, or financial data carried over, consistent with the structure-only copy FR-22 and US-08 scenario 1 already specify for single-account templates. |
| 2 | Hard: a template is applied to an existing client some time after onboarding, not only at creation | Renata has two established client accounts, one holding a template she wants to reuse, the other already active with its own campaigns | she applies that template to the second client account | the second client's template library gains a copy of the template's structure, without disturbing any of that client's existing campaigns, creators, or templates, and without exposing the source client's campaign data, creator lists, or financial data in the process. |
| 3 | Failure: an attempt to copy a template from a client account outside the caller's access | Renata (or an agency operator) attempts to use a template whose source client account she does not have `operator_client_access` to, or that belongs to a different agency workspace entirely | she requests the copy | the system refuses the request, states that the source is not accessible, and logs the denied attempt. No template structure or client data is copied across a boundary the caller cannot already read directly. |

**Governing NFRs:** NFR-09, NFR-16, NFR-17

**Related epic dependency:** Builds on E2's `campaign_template` entity (ADR-0010) and reuses the structure-only copy discipline US-08 scenario 1 already established for a single account; this story's genuinely new work is making that copy cross a client-account boundary within one agency workspace, and making it available as an ongoing action, not only at the moment of client creation.

---

## US-44 -- White-Label the Client-Facing Surface

**Status: partially built.** E7's ADR-0048 built a minimal `agency_branding_profile` table (`workspace_id`, `logo_url`, `primary_color_hex`, `secondary_color_hex`) and a configuration form at `/agency/branding`, applied **only** to the per-client report renderer (US-43). No domain field exists, and nothing beyond the report reads this entity. This story's scope is everything FR-57 names beyond that: a domain, and branding actually applied to the surfaces Renata's clients or her own team see day to day.

**Persona:** Renata (agency partner)

**As** Renata, **I want** to white-label the client-facing surface, **so that** Aurora is my infrastructure rather than my competitor.

**Priority:** Should

**Related functional requirements:** FR-57

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 1 | Normal: an agency configures full branding including a custom domain | Renata has already configured a logo and two colors via the existing `/agency/branding` form (E7) | she additionally configures a custom domain for her agency's workspace | the system stores and validates the domain, and the client-facing surfaces named in scenario 2 become reachable and rendered under that domain, in addition to carrying her logo and colors. |
| 2 | Hard: branding is consistently applied everywhere a client (or Renata's own team, acting for a client) interacts with Aurora, not only on the one report surface E7 already built | Renata has configured branding (logo, colors, domain) | she or her team opens any client-facing surface this epic defines as in scope (see Open questions on exactly which surfaces that includes) | every such surface renders with her agency's branding, not Aurora's, consistently with the already-built report rendering (US-43), rather than branding being visible on reports alone while every other touchpoint still shows Aurora's own identity. |
| 3 | Failure: branding is only partially configured, or not configured at all | An agency workspace has no `agency_branding_profile` row, or one with every field still `null` | a client-facing surface is rendered for that workspace | the system falls back to a neutral, agency- and Aurora-agnostic presentation, exactly as ADR-0048 already resolved for the one surface it built (US-43's report), never silently falling back to Aurora's own branding, which would contradict this story's own stated purpose. |

**Governing NFRs:** NFR-09, NFR-16, NFR-17

**What is already built:** the `agency_branding_profile` entity and its configuration form, logo and two colors only, applied only to the per-client report (E7, ADR-0048). The unbranded-fallback rule (scenario 3) is also already established precedent from ADR-0048 and is simply extended here to whatever new surfaces this story adds.

**What remains:** the domain field and its mechanics (DNS verification, routing, certificate provisioning), extending `agency_branding_profile` rather than replacing it (per ADR-0048's own stated hand-off); and applying branding to whichever client-facing surfaces beyond the report are actually in scope, a question this document cannot resolve on its own (see Open questions).

---

## US-45 -- Grant Per-Client Permissions to Team Members

**Status: already fully implemented, by E1.** FR-58 is shipped production code: `operator_client_access` (the join table), and `POST`/`DELETE /agency/clients/:clientId/operators` (`agency.controller.ts`, `agency.service.ts`'s `grantOperatorAccess`/`revokeOperatorAccess`). No new backend or frontend work is specified by this story beyond the audit-log-visibility addendum below, which is shared with US-38.

**Persona:** Renata (agency partner)

**As** Renata, **I want** to grant my team per-client permissions, **so that** account managers only reach the clients they handle.

**Priority:** Should

**Related functional requirements:** FR-58

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 1 | Normal: an operator is granted access to exactly one client | Renata (as `agency_admin`) has a team member already holding the `agency_operator` role in her workspace | she grants that operator access to one specific client account | the operator can thereafter view and act on that client's campaigns, creators, content, and financial data, and on no other client's data, until further access is granted. |
| 2 | Hard: an operator is granted access to more than one client, then has one revoked | An operator already has access to Client A and Client B | Renata revokes the operator's access to Client B only | the operator retains full access to Client A, and immediately loses all access to Client B, with no delay and no need for the operator to log out and back in. |
| 3 | Failure: an attempt to grant access for a user who is not an agency operator in this workspace | Renata attempts to grant client access to a user who holds no `agency_operator` membership in her workspace (for example, a user who was never invited, or who holds a different role) | she submits the grant | the system refuses the grant, states that the target user is not an operator in this workspace, and creates no access record. |

**Governing NFRs:** NFR-09, NFR-16, NFR-17

**Built by:** E1 (`docs/architecture/e1-access-onboarding.md` section 2.4; `backend/src/agency/agency.service.ts`'s `grantOperatorAccess`/`revokeOperatorAccess`).

---

## Shared addendum to US-38 and US-45 -- View the Audit Log of Actions Taken Within a Client Account

*(not a separately numbered PRD story; this is the one genuinely unbuilt piece of FR-60, which Table 15 traces to both US-38 and US-45)*

**Status: the write path is fully built platform-wide and already in use (`backend/src/audit/audit.service.ts`, called by every epic's own write actions, including `client_account.created`, `operator_access.granted`, `operator_access.revoked`, and `authorization.denied`). No read path exists anywhere: there is no audit-log controller or endpoint in the codebase, and no epic's frontend route map names a screen for viewing it.** "Maintain an audit log... attributable to the acting user" (FR-60) is satisfied at the storage level today, but not at the level Renata could ever actually use it, which is the plain purpose both US-38 ("I stop managing clients in separate spreadsheets") and US-45 ("account managers only reach the clients they handle") depend on being verifiable, not merely true.

**Persona:** Renata (agency partner)

**Priority:** Should (inherits FR-60's own PRD priority)

**Related functional requirements:** FR-60

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 1 | Normal: Renata reviews what happened in one client account | A client account has accumulated audit events over time (account creation, operator grants/revokes, campaign and content actions written by other epics) | Renata (as `agency_admin`) requests that client's audit log | she sees a chronological, paginated list of actions taken within that specific client account, each one attributed to the acting user, with no entry from any other client account mixed in. |
| 2 | Hard: an agency operator requests the log for a client they have access to, versus one they do not | An operator holds `operator_client_access` for Client A but not Client B | the operator requests Client A's audit log, then attempts Client B's | Client A's log is returned in full; the Client B request is refused with an authorization error and is itself logged as a denied attempt (NFR-16), the same isolation guarantee US-38 scenario 3 already establishes for every other kind of client data. |
| 3 | Failure: an attempt to alter or delete an audit entry | Any user, including `agency_admin`, attempts to modify or remove an existing audit log entry, whether through the UI (none is offered) or a direct API or database call | the attempt is made | the system refuses it outright; the audit log remains append-only (the same database-level immutability trigger E1 already established for `audit_log`), and the refusal itself does not need to be separately logged since no write path to alter history exists at all. |

**Governing NFRs:** NFR-16, NFR-17

---

## Stories traced to the agency persona but not to E9 (considered, not missed)

Table 4 of the PRD originally catalogs US-42, US-43, US-46, and US-47 under Renata's persona alongside this epic's own five stories, but Table 15's traceability matrix -- the authoritative per-epic assignment this document follows, consistent with every other epic's stories document -- assigns each of the four elsewhere:

- **US-42** (consolidated per-client billing, Aurora settling creator payouts directly) is **E6**'s story. Fully built; see `docs/epics/e6-payments-financial-transparency/stories.md` and ADR-0040.
- **US-43** (per-client reports under the agency's own branding) is **E7**'s story. Fully built except the branding entity's extension, which this document picks up as part of US-44; see `docs/epics/e7-analytics-reporting/stories.md` and ADR-0048.
- **US-46** (cross-client performance comparison) is **E7**'s story. Fully built, including its own cross-tenant RLS escape hatch; see `docs/epics/e7-analytics-reporting/stories.md` and ADR-0048.
- **US-47** (agency client onboarding reusing existing configuration and templates) is **E1**'s story. Fully built; see `docs/epics/e1-access-onboarding/stories.md`.

None of the four is re-specified in this document. They are named here explicitly so the record shows they were checked against Table 15 and accounted for, not overlooked because they carry Renata's name.

---

## Open questions

1. **What "client-facing surface" means in FR-57/US-44 is not stated by the PRD, and the platform's own role model makes the plain reading ambiguous.** FR-04 names six roles -- brand owner, brand manager, brand analyst, creator, agency administrator, agency operator -- and none of them represents the agency's own end client as a distinct logged-in user. If a client company never logs into Aurora directly, "white-labeling the client-facing surface" could mean: (a) theming the agency workspace UI itself, so that when an operator acts on behalf of a client, every screen carries the agency's branding instead of Aurora's; (b) a separate, externally shareable branded surface (a link or lightweight portal) that the agency sends to its actual client company, who has no Aurora login at all; or (c) something else entirely. This document's scenario 2 deliberately does not resolve which surfaces are in scope, since the PRD gives no basis to choose among these readings, and recommends this be settled with product before US-44 is built.

2. **Branding granularity -- one look per agency workspace, or one look per client -- is unresolved, carried forward from ADR-0048.** ADR-0048 states this explicitly as its own open assumption: `agency_branding_profile` is keyed to `workspace_id`, meaning every client under one agency currently gets the same branding. FR-57's wording does not rule out an agency wanting a different look per client (for example, an agency serving visually distinct brand clients). This document does not resolve that question either; if product later states client-level branding is required, extending `agency_branding_profile` to a per-client key is the shape that change would take, not a new table.

3. **Custom domain mechanics are entirely unspecified by the PRD.** FR-57 names "domain" as one of the three things an agency can configure, but nothing in the PRD states what DNS verification, SSL/certificate provisioning, or routing behavior a custom domain implies, nor whether this is even in scope for a pilot-scale, small-team build (NFR-33's cost-efficiency framing suggests caution here). This document records the gap rather than inventing a mechanism.

4. **Whether cross-client template reuse (US-41) should be a one-time action at client onboarding, an ongoing action available any time, or both, is not stated explicitly by FR-22.** This document's acceptance criteria (US-41, scenarios 1 and 2) assume both are in scope, since US-41's own wording ("apply reusable templates across clients") reads as an ongoing capability rather than a one-time onboarding step, and E1's existing `copy_templates_from` parameter already gestures at the onboarding-time case without implementing it. Recommend confirming with product that both cases are wanted before committing to the larger of the two scopes.

5. **The audit-log-visibility addendum (FR-60) is scoped in this document to agency client accounts only, matching Table 15's own traceability of FR-60 to US-38 and US-45.** Whether an equivalent read surface should also exist for a direct brand workspace's own audit trail (no agency involved at all) is not addressed by this document, since neither Table 15 nor any brand-facing story traces FR-60 anywhere outside E9. This is recorded as a scope boundary this document deliberately holds to, not an oversight.

6. **Whether granting per-client access (US-45) should itself require the target operator to have MFA enabled, the way E1 already requires it for roles with financial privileges (NFR-19), is not addressed by FR-58 or by Table 15's NFR list for this epic.** Table 15 does not name NFR-19 among E9's governing NFRs, and this document does not add it on its own inference; recorded here in case product intends per-client access itself to count as a financial-adjacent privilege (an operator granted access to a client can, after all, reach that client's invoices and payout-adjacent views built elsewhere).
