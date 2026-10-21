# ADR-0036: Payout Obligation Creation Wired via an Exported `PayoutObligationService`, Called From E5's Publication-Confirmation Transaction

**Status:** Proposed
**Date:** 2026-10-21
**Epic:** E6 -- Payments and Financial Transparency
**Governs:** US-35a, FR-44

## Context

FR-44 requires creating a payout obligation "when publication is confirmed under FR-42 and the content has passed approval." E5's architecture document names this epic's hand-off point explicitly: `POST /creator-portal/content-submissions/:id/confirm-publication` already sets `content_submission.published_url`/`published_at` and writes the audit log entry `content_submission.publication_confirmed`, stating directly that "a future E6 implementation can key off" that event. The question this ADR resolves is mechanical: *how*, concretely, does this epic's code actually run when that endpoint succeeds, given that this codebase has no event bus, message broker, or `EventEmitter2` anywhere in `backend/src` -- every cross-module hand-off actually built so far (E4 exporting `BrandSafetyGateService` for E5 to call, per ADR-0032) is a direct, in-process service call inside one database transaction, not a published-and-subscribed event.

Two structural options were considered:

- **Treat the audit log as the integration surface.** A background process could poll `audit_log` for `content_submission.publication_confirmed` entries not yet processed and create obligations from them. This would avoid touching `content-workflow.module.ts` at all, but it reintroduces exactly the kind of eventual-consistency gap `docs/architecture.md`'s own style rationale (section 2.1) rejects for the money path ("A single transactional store for the money path; rules out eventual consistency there") -- a crash between the audit write and the poller's next run would leave a confirmed publication with no obligation for an indeterminate window, which is the opposite of FR-44's "the moment my publication is confirmed."
- **Extend E5's existing transaction with one additional, in-process call**, exactly the mechanism ADR-0032 already established for `brand-safety`/`content-workflow`: `content-workflow.module.ts` imports the new `PaymentsModule`, and `PublicationService.confirmPublication` calls this epic's exported `PayoutObligationService.createForConfirmedPublication(...)` in the same transaction as the `published_url`/`published_at` write.

## Decision

E6 exports exactly one method other modules may call, `PayoutObligationService.createForConfirmedPublication`, from `payments.module.ts`:

```typescript
interface CreateForConfirmedPublicationInput {
  contentSubmissionId: string;
  campaignId: string;
  creatorId: string;
  opportunityId: string;
  publishedAt: Date;
}

// Exported by PaymentsModule. The only caller in the codebase is
// content-workflow's PublicationService, immediately after it writes
// published_url/published_at and before it writes the audit log entry
// content_submission.publication_confirmed, in the same transaction.
interface PayoutObligationService {
  createForConfirmedPublication(input: CreateForConfirmedPublicationInput): Promise<{
    payoutObligationId: string;
    alreadyExisted: boolean; // true on a redelivered/retried call, US-35a scenario 2
  }>;
}
```

This requires one small, additive wiring change to `content-workflow.module.ts` (importing `PaymentsModule`) and to `PublicationService`'s constructor (injecting `PayoutObligationService`), exactly the shape ADR-0032 already used for `brand-safety.module.ts`'s equivalent change. `createForConfirmedPublication` is idempotent by construction: it inserts `payout_obligation` with the `UNIQUE (content_submission_id)` constraint (section 3.6 of the E6 architecture document) and treats a conflict as "already existed," returning the existing row's id rather than erroring -- satisfying US-35a scenario 2 ("a redelivered or retried confirmation never creates a duplicate") without requiring the caller to check first.

Inside `createForConfirmedPublication`, before inserting, the service defensively verifies `publishedAt` is non-null on the input it received and that the referenced `campaign_opportunity` exists with `status = 'accepted'` -- reading `campaign_opportunity` directly, the one table every module in this codebase already treats as shared reference data (section 2.2 of the E6 architecture document), never reaching into `content-workflow`'s own `content_review_decision` table to repeat a check only `content-workflow` is positioned to make correctly. On either check failing, it refuses, writes audit log `payout_obligation.creation_refused` with the specific reason, and creates no row -- satisfying US-35a scenario 3 without this module needing to re-verify a fact its one caller has already established.

## Consequences

**What Aurora gains:**
- The obligation is created in the same ACID transaction as the publication confirmation itself, which is exactly the "single transactional store for the money path" `docs/architecture.md` section 2.1 already commits to -- there is no window, however small, in which a publication is confirmed but no obligation yet exists for it to be lost in.
- The idempotency guarantee comes from a database constraint, not from the caller remembering to check first -- a second call (from a retried request, a redelivered queue message, or any other source of duplication) is a no-op by construction, the same discipline `docs/architecture.md`'s S-02 already requires for payout execution, applied here one step earlier, at creation.
- The wiring change is a well-rehearsed pattern in this codebase (this is the third time it is used, after E4-to-E5 for `BrandSafetyGateService` and `ContentSubmissionService`), so the engineering risk of the integration itself is low relative to the rest of this epic's genuinely new work.

**What Aurora gives up:**
- `content-workflow`'s `PublicationService` now depends on one more module (`payments`), growing its dependency surface slightly -- the same cost ADR-0032 already accepted for `brand-safety`, and bounded the same way: the dependency is on one narrow, stable method, not on `payments`' internals.
- If `PayoutObligationService.createForConfirmedPublication` is ever slow (it should not be -- it is a small number of indexed reads/writes, well within NFR-04's write budget), it would directly slow down E5's publication-confirmation endpoint, since the two now share one transaction. This is an accepted coupling, consistent with the money path intentionally not being made asynchronous at this step (NFR-13 outranks the marginal latency cost here, the same tradeoff `docs/architecture.md`'s T-01 already resolves in favor of integrity).

**Risk:** A future change to E5's `confirmPublication` that reorders or removes the call into `PayoutObligationService` would silently break FR-44 with no compiler error (TypeScript cannot enforce "this method must be called from exactly this call site"). Mitigation: an integration test, in the same category `docs/architecture.md` section 5.2 already mandates for cross-tenant and idempotency properties ("enforced by the database... a mocked repository would pass while the real guarantee was broken"), asserting that confirming publication for an approved, safety-cleared submission always results in exactly one `payout_obligation` row.
