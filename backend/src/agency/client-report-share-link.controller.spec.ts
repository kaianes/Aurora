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
});
