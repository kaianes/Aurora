# ADR-0042: Payment Statements Are On-Demand PDFs via Object Storage, Not a Stored Database Document

**Status:** Proposed
**Date:** 2026-10-21
**Epic:** E6 -- Payments and Financial Transparency
**Governs:** US-36a, FR-47

## Context

FR-47 requires "downloadable statements" without naming a format. PRD open question 5 is explicit that this is deliberately unresolved: "FR-53, the brand-facing report export, explicitly names 'a portable document and tabular format.' FR-47 only says 'downloadable' with no format named. This document does not assume PDF, CSV, or both" -- a statement the stories document itself makes about its own scope, which this architecture document must now actually resolve into something backend-dev can build, since "downloadable" is not buildable without a concrete format and delivery mechanism.

`docs/architecture.md` section 2.5 (Table 3) already names object storage's purpose platform-wide: "Drafts, reports, and media kits are large and rarely read; kept out of the database and the recovery window." A payment statement is squarely in that category -- a generated document, read rarely (a creator checking their own records), that does not need to live inside the relational store or inside the 24-hour RPO backup window the way a `payout_obligation` row itself does.

## Decision

A statement is a **generated PDF, stored in S3-compatible object storage, served via a short-lived signed URL** (one hour, the same lifetime E1 already uses for brand-profile logos) -- not a pre-generated, permanently stored document, and not a CSV or any other tabular format in this release. `GET /creator-portal/payout-obligations/:id/statement` (section 4.3 of the E6 architecture document) generates the PDF on request (or returns a still-valid cached one), covering exactly the one obligation's gross/commission/net/status/dates -- there is no cross-obligation, period-spanning statement format built in this release, mirroring the same per-obligation scoping decision ADR-0041 makes for tax documents, for the same reason (no cross-obligation aggregation requirement is named by any story).

CSV, or a combined "document and tabular" export matching FR-53's brand-facing framing, is explicitly not built now -- this document does not assume FR-47 needs to mirror FR-53's two-format requirement, since FR-47 itself never says so, and adding a second format later is new work on the same generation service, not a schema change (nothing about `payout_obligation`'s own schema depends on which format a statement is rendered in).

## Consequences

**What Aurora gains:**
- "Downloadable statements" has one concrete, buildable shape: a signed URL to a PDF, the same mechanism this codebase already uses successfully for brand-profile logos (E1) and will reuse again for tax documents (ADR-0041) -- no new infrastructure, no new object-storage access pattern, just a third use of an already-proven one.
- Generating on request (rather than eagerly, at settlement time, and storing permanently) means a statement is always rendered from the current state of its obligation row, which cannot drift out of sync with the underlying data the way a pre-generated, cached document could -- the same "compute at read time, never cache a derived fact that could go stale" discipline E3 and E5 already apply elsewhere (e.g., E5's `answered` flag, E3's `below_guaranteed_minimum`).
- Keeping the statement scoped to one obligation, not a period or a campaign, avoids inventing a period-closing or aggregation rule this epic has no requirement to build, mirroring ADR-0041's identical reasoning for tax documents.

**What Aurora gives up:**
- A creator who wants one document summarizing several payouts (e.g., everything from one campaign, or everything from one month) must download several per-obligation statements and assemble them manually -- there is no "statement for this period" endpoint in this release. This is a real, acknowledged gap relative to what FR-53's brand-facing equivalent offers Marina, left open rather than solved speculatively for a Should-adjacent, not-fully-specified requirement.
- No CSV or machine-readable export exists for a creator's own records in this release, even though US-36a scenario 1 only requires that Duda "can download a statement covering them" without specifying format -- if a future creator genuinely needs tabular data (e.g., to import into their own bookkeeping), that is new work.

**Risk:** If product or real creator feedback reveals that a single PDF per obligation is the wrong shape (too granular, wrong format, missing a period view), this design's choice not to build period-level aggregation now means that gap would need new work, not a configuration change. Mitigation: none beyond flagging this explicitly as an architectural default (not a resolved product decision) in section 7 of the E6 architecture document, consistent with PRD open question 5's own framing that this choice was never claimed to be final.
