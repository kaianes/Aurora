import { describe, it, expect } from 'vitest';
import { StubPayoutExecutionAdapter } from './payout-execution.adapter';

// ADR-0033: this pilot must never call or require a real payment
// processor's live or production API, and the stub must never, on its own,
// decide that money moved. This is the critical guarantee behind "the only
// path to a settled obligation is the MFA-gated operator endpoint" -- these
// tests pin that behavior so a future change to this file cannot silently
// start auto-settling obligations without the test suite catching it.
describe('StubPayoutExecutionAdapter - ADR-0033', () => {
  const adapter = new StubPayoutExecutionAdapter();

  it('executeTransfer always reports instructed with no provider reference, regardless of input', async () => {
    const result = await adapter.executeTransfer({
      payoutObligationId: 'pay-1',
      creatorId: 'creator-1',
      amount: '680.00',
      idempotencyKey: 'pay-1',
    });

    expect(result).toEqual({ outcome: 'instructed', providerReference: null });
  });

  it('checkStatus always reports pending -- it never decides an obligation has settled', async () => {
    const result = await adapter.checkStatus({
      providerReference: null,
      payoutObligationId: 'pay-1',
    });

    expect(result).toEqual({ outcome: 'pending' });
  });

  it('checkStatus reports pending even when given a providerReference from a prior instructed attempt', async () => {
    const result = await adapter.checkStatus({
      providerReference: 'some-opaque-reference',
      payoutObligationId: 'pay-1',
    });

    expect(result.outcome).toBe('pending');
  });
});
