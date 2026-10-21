import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClientReportShareLinkController } from './client-report-share-link.controller';

// US-44 / FR-57, section 5.5 of the E9 architecture doc. A thin wrapper:
// RolesGuard has already resolved whether the caller may act on
// clientAccountId (agency_admin, or agency_operator with
// operator_client_access for it) by the time either handler runs.
describe('ClientReportShareLinkController - US-44', () => {
  let controller: ClientReportShareLinkController;
  let shareLinkService: { mint: ReturnType<typeof vi.fn>; revoke: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    shareLinkService = { mint: vi.fn(), revoke: vi.fn() };
    controller = new ClientReportShareLinkController(shareLinkService as any);
  });

  function reqWith(userId = 'user-1') {
    return {
      user: { sub: userId },
      ip: '127.0.0.1',
      headers: { 'user-agent': 'vitest' },
    } as any;
  }

  it('forwards clientAccountId, reportId, and the actor context to mint', async () => {
    shareLinkService.mint.mockResolvedValue({
      token: 'tok-1',
      share_url: 'https://app.aurora.com.br/public/client-reports/tok-1',
      display_url: 'https://app.aurora.com.br/public/client-reports/tok-1',
      expires_at: '2026-11-20T10:00:00Z',
    });

    const result = await controller.mint('client-1', 'rpt-1', reqWith());

    expect(shareLinkService.mint).toHaveBeenCalledWith(
      'client-1',
      'rpt-1',
      expect.objectContaining({ userId: 'user-1', ipAddress: '127.0.0.1', userAgent: 'vitest' }),
    );
    expect(result.token).toBe('tok-1');
  });

  it('forwards clientAccountId, reportId, linkId, and the actor context to revoke', async () => {
    shareLinkService.revoke.mockResolvedValue(undefined);

    await controller.revoke('client-1', 'rpt-1', 'link-1', reqWith());

    expect(shareLinkService.revoke).toHaveBeenCalledWith(
      'client-1',
      'rpt-1',
      'link-1',
      expect.objectContaining({ userId: 'user-1' }),
    );
  });

  // ---- NFR-16 / US-44 cross-tenant check: RolesGuard only ever resolves and
  // authorizes the account named by the request's own X-Account-Id header
  // (set on req.currentAccountId); it never inspects the :clientAccountId
  // route param this controller also receives. A caller who sends a
  // legitimate X-Account-Id for an account they truly hold (e.g. their own
  // home account, or Client A, which they have operator_client_access for)
  // can still put an entirely different, unauthorized account's id in the
  // :clientAccountId path segment, and neither the controller nor
  // ClientReportShareLinkService.mint/revoke ever compares the two. Minting
  // a share link for an account the caller cannot otherwise reach is a
  // genuine cross-tenant data leak (worse than a one-off read, since the
  // resulting public, unauthenticated link exposes that account's report
  // indefinitely until revoked or expired). This test documents the
  // required behavior; it currently fails because no such check exists in
  // either the controller or the service.
  it('refuses to mint a share link when clientAccountId does not match the caller\'s RolesGuard-resolved account', async () => {
    const req = reqWith();
    (req as any).currentAccountId = 'client-a-authorized';

    await expect(
      controller.mint('client-b-NOT-authorized', 'rpt-1', req),
    ).rejects.toThrow();

    expect(shareLinkService.mint).not.toHaveBeenCalled();
  });

  it('refuses to revoke a share link when clientAccountId does not match the caller\'s RolesGuard-resolved account', async () => {
    const req = reqWith();
    (req as any).currentAccountId = 'client-a-authorized';

    await expect(
      controller.revoke('client-b-NOT-authorized', 'rpt-1', 'link-1', req),
    ).rejects.toThrow();

    expect(shareLinkService.revoke).not.toHaveBeenCalled();
  });
});
