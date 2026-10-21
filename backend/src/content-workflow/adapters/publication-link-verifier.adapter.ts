import { Injectable } from '@nestjs/common';

export interface PublicationLinkVerifierInput {
  publishedUrl: string;
  approvedCaptionText: string;
}

export type PublicationLinkVerifierResult =
  | { resolved: true; matches: true }
  | { resolved: true; matches: false; fetchedCaptionText: string | null }
  | { resolved: false };

// A dedicated adapter, independent of E4's LiveContentFetcher (ADR-0031): a
// hard pre-publication gate needs a different risk tolerance than E4's soft,
// periodic monitor, so the two are never coupled even though they solve a
// structurally similar fetch-and-compare problem. Comparison scope is
// caption text only, after whitespace normalization, treated as an exact
// match (ADR-0031, PRD open question 7).
export interface PublicationLinkVerifierAdapter {
  verify(input: PublicationLinkVerifierInput): Promise<PublicationLinkVerifierResult>;
}

export const PUBLICATION_LINK_VERIFIER_ADAPTER = 'PUBLICATION_LINK_VERIFIER_ADAPTER';

// No real platform-link-verification integration exists yet. This stub
// unconditionally reports a resolved, matching link, consistent with the
// pilot/demo default ADR-0031 names explicitly ("consistent with
// StubMediaExtractionAdapter's precedent in E4"). Swapping in a real
// implementation is a change to this class and its DI binding only (NFR-29).
@Injectable()
export class StubPublicationLinkVerifierAdapter implements PublicationLinkVerifierAdapter {
  async verify(_input: PublicationLinkVerifierInput): Promise<PublicationLinkVerifierResult> {
    return { resolved: true, matches: true };
  }
}
