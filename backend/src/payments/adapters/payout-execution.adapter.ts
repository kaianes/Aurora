import { Injectable } from '@nestjs/common';

export interface PayoutExecutionInput {
  payoutObligationId: string;
  creatorId: string;
  amount: string; // payout_net, BRL
  idempotencyKey: string; // = payoutObligationId, per docs/architecture.md S-02
}

export type PayoutExecutionResult =
  | { outcome: 'instructed'; providerReference: string | null }
  | { outcome: 'failed'; reason: string };

export interface PayoutStatusCheckInput {
  providerReference: string | null;
  payoutObligationId: string;
}

export type PayoutStatusCheckResult =
  | { outcome: 'settled' }
  | { outcome: 'failed'; reason: string }
  | { outcome: 'pending' };

// ADR-0033: the only internal abstraction payout logic depends on (NFR-36).
// Consumed by exactly two things: attempt-payout-execution and
// poll-in-flight-payouts (section 5 of the E6 architecture doc) -- no
// controller, no other module, calls it directly.
export interface PayoutExecutionAdapter {
  executeTransfer(input: PayoutExecutionInput): Promise<PayoutExecutionResult>;
  checkStatus(input: PayoutStatusCheckInput): Promise<PayoutStatusCheckResult>;
}

export const PAYOUT_EXECUTION_ADAPTER = 'PAYOUT_EXECUTION_ADAPTER';

// ADR-0033: this pilot ships exactly this one implementation. It makes no
// network call to any payment processor, sandbox or otherwise.
// executeTransfer always reports that an attempt was made, nothing more;
// checkStatus always reports pending -- the stub never, on its own, decides
// that money moved. The only way a payout_obligation reaches settled in
// this pilot is through the explicit, MFA-gated manual operator endpoints,
// which bypass checkStatus entirely. A real StripeConnectPayoutAdapter or
// direct Brazilian-PSP-Pix adapter is explicitly not built by this epic:
// swapping one in is a new class and a DI binding change, nothing else.
@Injectable()
export class StubPayoutExecutionAdapter implements PayoutExecutionAdapter {
  async executeTransfer(_input: PayoutExecutionInput): Promise<PayoutExecutionResult> {
    return { outcome: 'instructed', providerReference: null };
  }

  async checkStatus(_input: PayoutStatusCheckInput): Promise<PayoutStatusCheckResult> {
    return { outcome: 'pending' };
  }
}
