# ADR-0031: Publication Link Verification Behind a Dedicated Adapter, Independent of E4's Monitoring Fetcher

**Status:** Proposed
**Date:** 2026-10-21
**Epic:** E5 -- Briefing and Content Workflow
**Governs:** US-34, FR-42

## Context

FR-42 requires that publication confirmation validate "that the link resolves and corresponds to the approved content." US-34 scenario 2 requires detecting when "the live post's actual content (caption, on-screen text, or audio) differs from the version that was approved and cleared" and refusing to record the publication in that case. US-34 scenario 3 requires distinguishing a dead/unreachable link from content that has simply never cleared the safety gate.

E4 already built a live-fetch mechanism for a superficially similar purpose: `LiveContentFetcher.fetchLiveCaption` (ADR-0024), used by the `monitor-published-content` cron job to periodically compare a published post's current caption against the snapshot taken at approval time. `LiveContentFetcher` is deliberately narrow and is **not exported** from `brand-safety.module.ts` -- only `BrandSafetyGateService` is. Two options were considered for US-34's own link check:

- **Export and reuse `LiveContentFetcher` directly.** This would avoid building a second fetch mechanism, but it would couple a hard, pre-publication *gate* (US-34's check must block a mismatched publication outright) to an adapter ADR-0024 deliberately designed for a soft, periodic *monitor* ("deliberately shallow... does not over-engineer it," checking only caption text, tolerant of being wrong for a cycle since the next cycle corrects it). Widening `LiveContentFetcher`'s contract or its guarantees to serve a gate would risk weakening the monitoring job's own simplicity, which ADR-0024 was explicit about preserving.
- **A new, dedicated adapter**, `PublicationLinkVerifierAdapter`, owned by `content-workflow`, used only by the publication-confirmation endpoint, with no relationship to `LiveContentFetcher` beyond solving a structurally similar problem (fetch a live post, compare it to an approved baseline).

## Decision

E5 defines `PublicationLinkVerifierAdapter` (section 4.6 of the E5 architecture document), bound via a DI token the same way `ContentSafetyAdapter` and `MediaExtractionAdapter` are bound in `brand-safety` (ADR-0021's precedent):

```typescript
interface PublicationLinkVerifierAdapter {
  verify(input: { publishedUrl: string; approvedCaptionText: string }): Promise<
    | { resolved: true; matches: true }
    | { resolved: true; matches: false; fetchedCaptionText: string | null }
    | { resolved: false }
  >;
}
```

Comparison scope is **caption text only**, compared after whitespace normalization, treated as an exact-match requirement -- any other detectable difference blocks confirmation. This mirrors ADR-0024's own scope-limiting choice (caption only, not on-screen text or audio) for the same reason: on-screen text and audio require extraction (OCR/ASR) from the live asset, which this one-time gate check does not perform, consistent with keeping a pilot-scale feature's cost and complexity bounded rather than re-running a full extraction pipeline against an external URL at confirmation time. A stub implementation (for pilot/demo environments without a live fetch integration) returns `resolved: true, matches: true` unconditionally, consistent with `StubMediaExtractionAdapter`'s precedent in E4.

## Consequences

**What Aurora gains:**
- `brand-safety`'s monitoring job (US-16b) and this epic's publication gate (US-34) can each evolve independently -- a future decision to make the monitoring job more lenient (e.g., tolerate N consecutive unreachable cycles before flagging, per ADR-0024's own stated future direction) never risks loosening the one-time, hard gate this epic enforces at confirmation, and vice versa.
- The adapter boundary is consistent with the platform-wide inference/fetch-adapter discipline (`docs/architecture.md` section 2.1), extended here to a third concern (link verification) alongside matching and brand safety, without any of the three depending on each other's implementation.

**What Aurora gives up:**
- Two independent live-fetch mechanisms now exist in the codebase (E4's `LiveContentFetcher`, this epic's `PublicationLinkVerifierAdapter`) solving similar-looking problems with different contracts and different tolerance for being wrong. A future engineer could reasonably ask why they are not the same thing; this ADR is the answer, and it holds as long as one remains a hard pre-publication gate and the other a soft periodic monitor with deliberately different risk tolerance.
- The exact tolerance for "corresponds to the approved content" (PRD open question 7) is not resolved at the product level by this decision -- exact-match-after-whitespace-normalization on caption text alone is an architectural default, adopted because it is the only reading consistent with FR-33's zero-tolerance framing elsewhere in the platform (as the stories document itself argues), not because product has confirmed it. A watermark, a platform-added caption truncation, or a trivial formatting difference introduced by the social platform itself would all currently block confirmation under this rule; if product decides some such differences should be tolerated, that is a change to this adapter's comparison logic, not a schema change.

**Risk:** `PublicationLinkVerifierAdapter`'s real implementation depends on the same category of external dependency as `LiveContentFetcher` -- a social platform's public-page or API accessibility, outside Aurora's control (the same risk category NFR-35 already addresses for metric ingestion and ADR-0024 already names for monitoring). Unlike the monitoring job, this gate cannot "degrade gracefully and try again next cycle" -- an unreachable link at confirmation time is a hard refusal (US-34 scenario 3), so a transient platform outage at the exact moment Duda tries to confirm publication would incorrectly block her. Mitigation: the error response (`PUBLICATION_LINK_UNREACHABLE`) is explicitly retryable messaging, not a permanent rejection, and Duda can simply try again once the link resolves.
