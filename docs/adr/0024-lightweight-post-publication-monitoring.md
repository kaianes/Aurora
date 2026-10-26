# ADR-0024: Post-Publication Monitoring Does One Cheap Fetch Per Post Per Cycle, Never a Full Safety Re-Check

**Status:** Proposed
**Date:** 2026-10-20
**Epic:** E4 -- Brand Safety
**Governs:** US-16b, FR-35, NFR-34

## Context

US-16b (Could priority, split out from US-16 specifically because it is "a materially different capability") asks Aurora to periodically check whether a published post still matches what was approved, distinguishing "edited" from "removed or unreachable" (scenario 3), and to avoid ever treating a removed post as compliant simply because there is nothing left to re-check. PRD open question 7 leaves cadence, notification, and available actions explicitly unspecified, consistent with FR-35's lower priority.

The task governing this epic's build is explicit that this feature should stay simple: "a periodic job comparing live content against the approved snapshot is sufficient, do not over-engineer it." Two implementation approaches were considered:

- **Re-run the full safety cascade against the live post on every monitoring cycle** -- re-extract on-screen text and audio from whatever is currently live, re-run both tiers of `ContentSafetyAdapter` against the campaign's current effective ruleset, and compare the new verdict to the original. This would answer a richer question ("does the live post *still pass brand safety*, not just *does it match what was approved*") but it means every published post in every active campaign pays the full cascade's cost on a recurring schedule -- which is exactly the kind of per-creator, per-cycle cost NFR-34 exists to rule out. A 150-creator campaign monitored every 6 hours would run 150 full safety checks per cycle, every cycle, for the life of the campaign, on top of the one check each submission already paid for before publication.
- **A single cheap fetch-and-compare per post per cycle**, checking only reachability and caption text against the snapshot taken at approval time, with no re-extraction and no re-invocation of the safety cascade at all.

## Decision

`monitor-published-content` (a cron job, default cadence every 6 hours, adopted as a pilot default per PRD open question 7 and explicitly open to revision) does exactly one thing per active `published_content_snapshot`: call `LiveContentFetcher.fetchLiveCaption(publishedUrl)`, a minimal interface returning `{ reachable: boolean; captionText?: string }`, and compare the result to the snapshot's `approved_caption_text`.

- **Unreachable** (`reachable = false`, including a 404, a private/deleted post, or a fetch error): `last_result = 'unreachable'`, `deviation_details = { reason: 'link_unreachable_or_removed' }`, `consecutive_unreachable_count` incremented. This is never reported as `matching` -- the absence of content to compare is its own distinct, explicitly flagged state (US-16b scenario 3's exact requirement).
- **Reachable, caption matches**: `last_result = 'matching'`, no further action.
- **Reachable, caption differs**: `last_result = 'deviated'`, `deviation_details` states the specific field and both values (US-16b scenario 2's "states what changed rather than simply noting 'a difference exists'").

On-screen text and audio are **not** re-extracted or re-compared on a schedule. The monitoring job only ever reads what the fetch adapter can cheaply retrieve (a caption and a reachability signal), never re-running OCR, ASR, or the safety cascade itself. There is also no history table behind `last_result`: each cycle overwrites the previous result on the same `published_content_snapshot` row, rather than accumulating a timeline -- consistent with keeping a Could-priority feature's data model as small as the requirement actually asks for.

## Consequences

**What Aurora gains:**
- Monitoring cost is O(published posts) per cycle, at the cost of one cheap fetch each -- not O(published posts) full safety checks per cycle. This keeps a Could-priority, "keep it simple" feature from becoming a second, recurring, linear-in-pool-size cost on top of the one safety check NFR-34 already has to keep sublinear.
- "Removed" and "edited" are structurally distinct outcomes (`unreachable` vs. `deviated`), satisfying US-16b scenario 3 without any special-case logic beyond checking the fetch's own reachability signal first.
- The monitoring job's dependency (`LiveContentFetcher`) is a narrow interface, consistent with this epic's general posture (ADR-0021) of keeping any provider-specific integration behind a port rather than calling a platform SDK inline from the cron job.

**What Aurora gives up:**
- This design answers "does the caption still match what was approved," not "is the live post still brand-safe" -- a creator could, in principle, edit on-screen text baked into a video or the spoken audio of an already-published clip without any change to the caption, and this monitoring job would report `matching`. This is an accepted, explicit scope limit given US-16b's Could priority and the instruction not to over-engineer it; broadening it to re-check all three channels is a future enhancement to `monitor-published-content`'s behavior, not a schema change, since `published_content_snapshot` already carries `approved_on_screen_text` and `approved_audio_transcript` fields for exactly that eventual purpose.
- No history of prior deviations is kept -- only the latest check's result. If Marina needs to know a post deviated, was fixed, then deviated again, this design shows only the most recent state. Revisiting this (adding a `published_content_deviation_event` log, mirroring the append-only event-log pattern already used elsewhere, e.g. `campaign_reallocation_event` in E2) is a straightforward additive change if product decides the history matters later.
- No notification beyond the listing endpoint (`GET /safety/monitoring`) is built; Marina must check the list to learn of a deviation. PRD open question 7 leaves notification unspecified, and this ADR does not invent one.

**Risk:** `LiveContentFetcher`'s reliability depends on each social platform's public-page or API accessibility, which is outside Aurora's control -- the same category of dependency NFR-35 already addresses for metric ingestion elsewhere in the platform (degrade gracefully, never block anything else). A platform tightening public access could increase `unreachable` false positives; the `consecutive_unreachable_count` field exists so a future refinement (e.g., only flag as removed after N consecutive unreachable cycles, rather than one) is a threshold change, not a schema change, if this proves noisy in practice.
