# ADR-0051: Separate `SocialAuthAdapter` and `CreatorAudienceInsightsAdapter`, Not an Extension of E7's `SocialMetricsAdapter`

**Status:** Proposed
**Date:** 2026-10-21
**Epic:** E8 -- Creator Recruitment and Growth
**Governs:** US-24.1, US-24.2, FR-08, FR-09, NFR-35

## Context

E7 already built `SocialMetricsAdapter` (ADR-0044) for a structurally similar-sounding problem: pulling data from a social platform API. The task driving this document explicitly asks for a reasoned decision on whether US-24.2's audience-metrics ingestion should reuse or extend that adapter, rather than silently building a second one. The two capabilities this epic needs -- OAuth authorization/token exchange (US-24.1) and audience-level metrics computation (US-24.2) -- also need to be checked against each other and against `SocialMetricsAdapter` individually, since conflating distinct capabilities behind one interface is its own kind of design mistake.

Examining `SocialMetricsAdapter`'s actual shape (E7 architecture doc section 4.1):

```typescript
pullMetrics(input: { creatorId, contentSubmissionId, platform, publishedUrl }): Promise<MetricsPullOutcome>
// returns { outcome: 'success', reach, engagement, impressions } | rate_limited | unreachable | auth_revoked
```

This adapter is keyed on **a single published piece of content** (`contentSubmissionId`), returns **post-level** performance (reach/engagement/impressions for that one post), and is called **only** by `discover-and-ingest-metrics`, a job owned by and scoped to `analytics`, triggered by `content_submission.published_at` existing. US-24.2 needs something categorically different: **account-level** audience composition (`audience_size`, `demographic_composition`, `engagement_rate` as an account average, `content_niche`) computed **once at onboarding** and periodically thereafter, with no dependency on any published content existing at all -- a brand-new creator with zero campaigns still needs this data the moment she links an account (US-24.2 scenario 1's explicit "within the onboarding session"). US-24.1, separately, needs the OAuth authorization-code exchange and token lifecycle itself (authorize URL, code exchange, refresh, revocation detection) -- a concern `SocialMetricsAdapter` has no interface surface for at all, since E7 was built on the explicit assumption that FR-08's tokens already exist (ADR-0044's own stated dependency: "ingestion depends on a creator having a linked social account with a valid authorization token (FR-08, E8) -- a dependency this epic assumes exists but does not itself build").

Three structural options were considered:

- **Extend `SocialMetricsAdapter` with new methods** for OAuth and audience insights, keeping one adapter per platform integration. Rejected: it would make `analytics`, a module whose only current external dependency is a narrow, read-only metrics pull keyed on published content, also own the OAuth token-exchange surface and the account-level audience-computation surface -- concerns this epic owns long-term, not `analytics`. It would also force every future platform-API change (e.g., a new audience-insights field) through a module whose own architecture document explicitly scopes its adapter to "exactly one thing: the `discover-and-ingest-metrics` job processor," widening that scope for a capability `analytics` has no other reason to know about.
- **One combined adapter for OAuth plus audience insights**, owned by `creator-network`. Considered more seriously, since both concerns belong to the same epic and module. Rejected because the two have genuinely different call shapes and lifecycles: OAuth linking is triggered once (plus periodic refresh) per `(creator, platform)` pair and deals in tokens; audience insights is triggered repeatedly (onboarding plus the 12-hour refresh job) and deals in audience data, using the token as an input rather than being about the token itself. Conflating them would make a future real implementation (e.g., swapping in Meta's actual Graph API client) harder to reason about, since the authorization lifecycle and the data-pull lifecycle genuinely fail independently (a token can be valid while a specific insights endpoint is rate-limited, and vice versa).
- **Two separate adapters, both owned by `creator-network`, neither touching `analytics`**: `SocialAuthAdapter` for the OAuth mechanics, `CreatorAudienceInsightsAdapter` for account-level metrics computation, each stub-only in this pilot, following the exact precedent every other epic's external dependency already established.

## Decision

Two new adapters are defined, both owned and exported by `creator-network`, both consumed only within that module:

- `SocialAuthAdapter` (E8 architecture doc section 3.1): authorization URL generation, code exchange, token refresh.
- `CreatorAudienceInsightsAdapter` (E8 architecture doc section 3.2): account-level audience size, demographic composition, engagement rate, content niche, keyed on `(creatorId, socialAccountId, platform, accessToken)` -- no `contentSubmissionId`, no dependency on any published content.

`SocialMetricsAdapter` is **not** extended, modified, or given new methods by this epic. `analytics.module.ts` is untouched by this decision (the one change this epic does make to `analytics` -- the media kit's exported read, ADR-0057 -- is unrelated to metrics ingestion). The two new adapters' failure taxonomies are deliberately kept symmetric with `SocialMetricsAdapter`'s existing one (`rate_limited | unreachable | auth_revoked` for the audience adapter; `denied | unavailable` for the OAuth adapter, which has no "stale data to preserve" concept since there is no prior successful state to fall back to before a first link succeeds) -- not because the adapters are related, but because this is the platform's established vocabulary for "a social platform call failed," and reusing it costs nothing and keeps NFR-35's graceful-degradation language consistent across every epic that touches a social platform.

## Consequences

**What Aurora gains:**
- `analytics` keeps the narrow, single-purpose adapter boundary its own architecture document already committed to ("consumed by exactly one thing: the `discover-and-ingest-metrics` job processor") -- this epic adds load to neither that module's scope nor its test surface.
- OAuth mechanics and audience-data mechanics can evolve independently: a future real `SocialAuthAdapter` implementation (e.g., handling Meta's specific authorization-code grant flow) can ship before, after, or independently of a future real `CreatorAudienceInsightsAdapter` implementation (e.g., calling the Instagram Graph API's audience-insights endpoint), each swappable via its own DI token with no change to the other.
- A future engineer reading `creator-network`'s adapters does not have to reason about why an OAuth-token-exchange method and a post-level-metrics-pull method live on the same interface -- each adapter's name and shape states exactly one job.

**What Aurora gives up:**
- This epic introduces two new adapters rather than reusing one, meaning two new DI tokens, two new stub implementations, and two new sets of integration tests for failure branches, rather than one extended interface. This is accepted because the alternative (reuse) would have been a false economy: `SocialMetricsAdapter`'s existing consumers and tests (`discover-and-ingest-metrics`, E7's integration suite) would need to be touched or at minimum re-reasoned-about for a capability they do not use, for no benefit beyond a smaller adapter count.
- A platform's real API client code, once built, may end up implemented across three adapters (`SocialAuthAdapter`, `CreatorAudienceInsightsAdapter`, `SocialMetricsAdapter`) rather than one unified client class -- a real implementation is free to share underlying HTTP client plumbing across all three (e.g., one internal `InstagramApiClient` used by all three adapter implementations), since nothing in this decision forbids code reuse below the adapter-interface boundary; it only forbids merging the interfaces themselves.

**Risk:** None specific to this split beyond the general risk every stub-only adapter in this codebase already carries (ADR-0033, ADR-0044): the real implementation's actual rate-limit behavior, error taxonomy, and latency are unknown until built, and this pilot's integration tests exercise the stub's failure branches via a mock, not a real platform's actual behavior.
