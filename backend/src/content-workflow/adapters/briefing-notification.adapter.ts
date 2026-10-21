import { Injectable } from '@nestjs/common';

export interface BriefingNotificationResult {
  delivered: boolean;
  failureReason?: string;
}

// Behind a DI token, same pattern as E4's MediaExtractionAdapter/
// ContentSafetyAdapter (ADR-0021's precedent). Used by the distribute-
// briefing job (section 5 of the E5 architecture doc): one attempt per
// recipient per issue action, never retried indefinitely.
export interface BriefingNotificationAdapter {
  deliver(creatorId: string, briefingId: string): Promise<BriefingNotificationResult>;
}

export const BRIEFING_NOTIFICATION_ADAPTER = 'BRIEFING_NOTIFICATION_ADAPTER';

// No real notification-provider integration exists yet. This stub always
// succeeds, consistent with the pilot/demo default named explicitly in
// section 5 of the E5 architecture doc. Swapping in a real implementation
// (the platform's notification-provider integration named in
// docs/architecture.md's context view) is a change to this class and its DI
// binding only (NFR-29).
@Injectable()
export class StubBriefingNotificationAdapter implements BriefingNotificationAdapter {
  async deliver(_creatorId: string, _briefingId: string): Promise<BriefingNotificationResult> {
    return { delivered: true };
  }
}
