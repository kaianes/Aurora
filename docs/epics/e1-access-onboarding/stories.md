# E1 -- Access and Onboarding

**Goal:** Remove the entry barrier that enterprise pricing and heavy onboarding create for mid-market brands and agencies, so that a buyer can start using Aurora without a sales cycle or an enterprise contract.

**Personas:** Marina (brand media manager), Renata (agency partner)

**Journey phases:** Marina evaluation; Renata evaluation and workspace setup

**Governing NFRs (apply to every story in this epic):**

| NFR | Attribute | Target |
|---|---|---|
| NFR-16 | Authorization | 100% of requests authorized server-side; zero successful cross-tenant reads; every denied attempt logged. **Promise holds at any scale.** |
| NFR-19 | Authentication | MFA available to all users and mandatory for roles that can approve payouts or change bank details |
| NFR-26 | Accessibility | WCAG 2.2 level AA on onboarding flows; level A elsewhere, with AA closing the gap after the pilot |
| NFR-27 | Usability | Brazilian Portuguese as the primary locale; all user-facing text externalized for translation |

---

## US-01 -- Self-Service Brand Sign-Up

**Persona:** Marina (brand media manager)

**As** Marina, **I want** to sign up and configure my workspace without going through a sales call, **so that** I can start without an enterprise procurement cycle.

**Priority:** Must

**Related functional requirements:** FR-01, FR-06

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 1 | Normal: successful registration | Marina navigates to the sign-up page and enters her company email, name, and a password that meets complexity rules | she submits the registration form | the system creates a brand workspace, sends a verification email, and displays a message telling her to check her inbox. No manual approval or sales interaction is required. |
| 2 | Hard: email already registered | Marina enters an email address that is already associated with an existing account | she submits the registration form | the system does not reveal whether the email exists (to prevent enumeration) and displays a generic message such as "If this email is registered, you will receive instructions." No duplicate account is created. |
| 3 | Failure: verification link expired | Marina receives the verification email but clicks the link after it has expired | she lands on the verification page | the system tells her the link has expired and offers a single action to resend a new verification email. The account remains inactive until verification succeeds. |

**Governing NFRs:** NFR-16, NFR-19, NFR-26, NFR-27

---

## US-02 -- Transparent Pricing Before Commitment

**Persona:** Marina (brand media manager)

**As** Marina, **I want** to see the full price before I commit, **so that** I can check it fits my budget without requesting a quote.

**Priority:** Must

**Related functional requirements:** FR-02

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 1 | Normal: pricing page visible pre-login | Marina has not yet created an account or logged in | she visits the pricing page | she sees the complete fee model, including any platform fee and commission structure, with no fields gated behind a login or a "contact sales" form. |
| 2 | Hard: pricing varies by workspace type | Marina is comparing brand workspace pricing with agency workspace pricing | she toggles between workspace types on the pricing page | both fee structures are displayed with a clear breakdown of what differs, so she can evaluate the right option without requesting a custom quote. |
| 3 | Failure: pricing page fails to load | Marina navigates to the pricing page but the backend service is unavailable | the page attempts to render | the system shows a meaningful error state with a retry action, rather than a blank page or a generic server error. Cached pricing content is served if available. |

**Governing NFRs:** NFR-16, NFR-26, NFR-27

---

## US-03 -- Brand Profile Registration

**Persona:** Marina (brand media manager)

**As** Marina, **I want** to register my brand profile, guidelines, and tone of voice, **so that** every campaign inherits them automatically.

**Priority:** Must

**Related functional requirements:** FR-03

This story covers: brand name, visual assets (logo), tone-of-voice description, content guidelines, and prohibited topics. All fields feed into campaign defaults and the brand safety ruleset (FR-31).

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 1 | Normal: complete profile creation | Marina has verified her account and is logged into her brand workspace | she fills in the brand name, uploads a logo, writes tone-of-voice notes, adds content guidelines, and lists prohibited topics, then saves | the system stores the profile and confirms it is saved. Every campaign she creates afterwards inherits these settings as defaults. |
| 2 | Hard: partial profile saved as draft | Marina starts filling in her brand profile but does not have the logo or full guidelines ready yet | she saves what she has entered so far | the system persists the partial profile as a draft so she can return later. She can still navigate the workspace, but the system indicates that the profile is incomplete and that campaigns cannot inherit a complete set of defaults until it is finished. |
| 3 | Failure: asset upload fails | Marina attempts to upload a logo file that exceeds the maximum allowed size or is in an unsupported format | she submits the upload | the system rejects the file, states the specific reason (size limit or unsupported format), and preserves all other data she has already entered on the form. |

**Governing NFRs:** NFR-16, NFR-26, NFR-27

---

## US-04 -- Team Invitation with Defined Roles

**Persona:** Marina (brand media manager)

**As** Marina, **I want** to invite teammates with defined roles, **so that** my team can collaborate without sharing one login.

**Priority:** Should

**Related functional requirements:** FR-04, FR-05

The roles relevant to a brand workspace in this story are: brand owner, brand manager, and brand analyst, as defined in FR-04.

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 1 | Normal: successful invitation | Marina is logged in as the brand owner | she enters a teammate's email address, selects a role (e.g., brand manager), and sends the invitation | the system sends an invitation email to the teammate. The invitation includes the assigned role. When the teammate accepts and creates their account, they land in Marina's workspace with exactly the permissions of the assigned role. |
| 2 | Hard: invited user already has an account on Aurora | Marina invites a colleague who already has their own Aurora account under a different workspace | the colleague accepts the invitation | the system adds the colleague to Marina's workspace with the assigned role without disturbing their existing account or workspace. The colleague can switch between workspaces. |
| 3 | Failure: invitation to an already-invited email | Marina sends an invitation to an email address that already has a pending, unaccepted invitation to the same workspace | she submits the invitation | the system informs Marina that a pending invitation already exists for that email and offers to resend it. It does not create a duplicate invitation. |

**Sub-scenario for role enforcement (derived from NFR-16):**

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 4 | Failure: insufficient privileges | A user with the brand analyst role is logged into the workspace | they attempt to invite another user or change a team member's role | the system denies the action, returns a clear authorization error, and logs the denied attempt. Only the brand owner (or a role explicitly granted invitation privileges) can manage team membership. |

**Governing NFRs:** NFR-16, NFR-19, NFR-26, NFR-27

---

## US-47 -- Agency Client Onboarding

**Persona:** Renata (agency partner)

**As** Renata, **I want** to onboard a new client without rebuilding my process, **so that** growing my roster does not grow my overhead proportionally.

**Priority:** Should

**Related functional requirements:** FR-06, FR-07, FR-59

This story assumes an agency workspace already exists (FR-06). The focus is on creating a new client account within that workspace, inheriting the agency's existing configuration and templates.

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 1 | Normal: new client account created | Renata is logged into her agency workspace as an agency administrator | she initiates client onboarding, enters the client's name and basic details, and confirms | the system creates a new client account within the agency workspace. The account inherits the agency's existing configuration (templates, branding defaults). Campaign, creator, content, and financial data for this client are isolated from all other client accounts (FR-07). |
| 2 | Hard: client account reuses a template from another client | Renata has a campaign template that was originally created under a different client account | she selects that template while setting up a campaign for the new client | the system copies the template structure into the new client's context. No data from the source client (creator lists, financial data, or content) is carried over -- only the campaign structure. |
| 3 | Failure: agency workspace has reached its client account limit | Renata's agency workspace already holds the maximum number of client accounts allowed by her plan (NFR-09 sets the pilot limit at 10) | she attempts to create an additional client account | the system blocks creation, states clearly that the limit has been reached, and indicates what action is needed to increase the limit (e.g., contacting support or upgrading the plan). Existing client accounts are unaffected. |

**Sub-scenario for data isolation (derived from NFR-16 and FR-07):**

| # | Scenario | Given | When | Then |
|---|---|---|---|---|
| 4 | Failure: cross-client data access attempt | An agency operator who has been granted access to Client A but not Client B | they attempt to view Client B's campaign data, whether through the UI or by manipulating an API request | the system denies access, returns an authorization error, and logs the attempt. Zero data from Client B is exposed. |

**Governing NFRs:** NFR-09, NFR-16, NFR-17, NFR-19, NFR-26, NFR-27

---

## Resolved Questions

1. **Brand profile completeness gate.** Campaigns can be created against an incomplete (draft) brand profile. The system should warn that defaults may be missing but not block creation.

2. **Role definitions and permissions matrix.** No detailed permissions matrix required upfront. Use standard RBAC semantics (owner can invite/assign roles, manager can manage campaigns, analyst is read-only). Refine later if needed.

3. **Agency workspace creation flow.** US-01 covers both brand and agency workspace creation. The sign-up form offers a workspace type choice (brand or agency) and the flow adapts accordingly. No separate story needed.

4. **Invitation expiry policy.** Invitations expire after 7 days. The inviter can resend.

5. **MFA enforcement timing.** MFA is enforced only when a user is assigned a role with financial privileges (e.g., payout approval, bank detail changes), not at initial registration. Registration must be as fast as possible.
