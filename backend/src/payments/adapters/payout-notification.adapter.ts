import { Injectable } from '@nestjs/common';

export interface PayoutNotificationInput {
  creatorId: string;
  payoutObligationId: string;
  reason: string;
}

export interface PayoutNotificationResult {
  delivered: boolean;
}

// ADR-0043: a dedicated adapter, independent of content-workflow's
// BriefingNotificationAdapter, since a payout-failure notification carries
// a 24-hour SLA and an in-app visibility guarantee independent of delivery
// (US-35c scenario 3) -- a different risk tolerance than a one-time
// briefing broadcast. Consumed by exactly one thing: the
// notify-payout-failure job (section 5 of the E6 architecture doc). The
// return value is informational only: no code path in this epic conditions
// an obligation's in-app visibility on this adapter's outcome.
export interface PayoutNotificationAdapter {
  notifyFailure(input: PayoutNotificationInput): Promise<PayoutNotificationResult>;
}

export const PAYOUT_NOTIFICATION_ADAPTER = 'PAYOUT_NOTIFICATION_ADAPTER';

// No real notification-provider integration exists yet. This stub always
// succeeds, mirroring StubBriefingNotificationAdapter and
// StubPublicationLinkVerifierAdapter's precedent. Swapping in a real
// implementation is a change to this class and its DI binding only.
@Injectable()
export class StubPayoutNotificationAdapter implements PayoutNotificationAdapter {
  async notifyFailure(_input: PayoutNotificationInput): Promise<PayoutNotificationResult> {
    return { delivered: true };
  }
}
