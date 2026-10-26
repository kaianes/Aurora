import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { SafetyCheckController } from './safety-check.controller';

// US-16 scenario 3: "anyone (Marina, a teammate, or an automated step in the
// workflow) attempts to mark that content as published" must be refused when
// the content has not passed. This controller is the thin HTTP wrapper
// section 3.6 of the E4 architecture doc describes for the record-publication
// side of the gate -- here we verify it never bypasses
// BrandSafetyGateService's own enforcement, regardless of who calls it, and
// that it enforces tenant isolation before ever reaching the gate.
describe('SafetyCheckController - US-16 scenario 3 (record-publication wrapper)', () => {
  let controller: SafetyCheckController;
  let contentSubmissionService: {
    getCheckStatus: ReturnType<typeof vi.fn>;
    findSubmissionForAccountOrFail: ReturnType<typeof vi.fn>;
  };
  let gateService: { recordPublication: ReturnType<typeof vi.fn>; getGateStatus: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    contentSubmissionService = {
      getCheckStatus: vi.fn(),
      findSubmissionForAccountOrFail: vi.fn(),
    };
    gateService = { recordPublication: vi.fn(), getGateStatus: vi.fn() };
    controller = new SafetyCheckController(contentSubmissionService as any, gateService as any);
  });

  function fakeReq(accountId: string) {
    return { currentAccountId: accountId } as any;
  }

  // The gate's own refusal (ConflictException / SAFETY_NOT_CLEARED) must propagate untouched --
  // the controller has no code path that swallows it or reports success anyway.
  it('propagates the gate refusal when the submission has not passed, regardless of caller role', async () => {
    contentSubmissionService.findSubmissionForAccountOrFail.mockResolvedValue({ id: 'sub-1' });
    gateService.recordPublication.mockRejectedValue(
      new ConflictException({
        error: { code: 'SAFETY_NOT_CLEARED', message: 'not cleared', details: { blocking_reason: 'flagged' } },
      }),
    );

    await expect(
      controller.recordPublication('sub-1', { published_url: 'https://instagram.com/p/abc' }, fakeReq('account-1')),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  // Tenant isolation is checked before the gate is ever consulted: a submission that does not
  // belong to the caller's account must not leak through to a cross-tenant publish attempt.
  it('checks tenant ownership before calling the gate, and never calls the gate for a foreign submission', async () => {
    contentSubmissionService.findSubmissionForAccountOrFail.mockRejectedValue(
      new NotFoundException({
        error: { code: 'SUBMISSION_NOT_FOUND', message: 'not found', details: {} },
      }),
    );

    await expect(
      controller.recordPublication('sub-foreign', { published_url: 'https://instagram.com/p/abc' }, fakeReq('account-1')),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(gateService.recordPublication).not.toHaveBeenCalled();
  });

  // The one path that does succeed: a cleared gate, reached only after tenant ownership is confirmed.
  it('records the publication only after tenant ownership is confirmed and the gate clears it', async () => {
    contentSubmissionService.findSubmissionForAccountOrFail.mockResolvedValue({ id: 'sub-1' });
    gateService.recordPublication.mockResolvedValue(undefined);

    const result = await controller.recordPublication(
      'sub-1',
      { published_url: 'https://instagram.com/p/abc' },
      fakeReq('account-1'),
    );

    expect(contentSubmissionService.findSubmissionForAccountOrFail).toHaveBeenCalledWith('sub-1', 'account-1');
    expect(gateService.recordPublication).toHaveBeenCalledWith('sub-1', 'https://instagram.com/p/abc');
    expect(result).toEqual({ content_submission_id: 'sub-1', recorded: true });
  });
});
