import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { PublicClientReportController } from './public-client-report.controller';

// US-44 / FR-57, section 5.5 of the E9 architecture doc. The only route in
// this epic reachable by someone who has never had an Aurora account --
// a thin wrapper forwarding the path token to
// ClientReportShareLinkService.getPublicView, which owns the actual
// token-match, revocation, and expiry checks.
describe('PublicClientReportController - US-44', () => {
  let controller: PublicClientReportController;
  let shareLinkService: { getPublicView: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    shareLinkService = { getPublicView: vi.fn() };
    controller = new PublicClientReportController(shareLinkService as any);
  });

  it('forwards the token and returns the service result unchanged', async () => {
    const body = {
      agency_name: 'Agencia Criativa',
      branding: { logo_url: null, primary_color_hex: null, secondary_color_hex: null, applied: false },
      report: { campaign_count: 5, total_spend: '180000.00' },
    };
    shareLinkService.getPublicView.mockResolvedValue(body);

    const result = await controller.getByToken('tok-1');

    expect(shareLinkService.getPublicView).toHaveBeenCalledWith('tok-1');
    expect(result).toEqual(body);
  });

  it('propagates LINK_NOT_AVAILABLE unchanged for a missing, revoked, or expired token', async () => {
    shareLinkService.getPublicView.mockRejectedValue(
      new NotFoundException({
        error: { code: 'LINK_NOT_AVAILABLE', message: 'Este link nao esta mais disponivel.', details: {} },
      }),
    );

    await expect(controller.getByToken('tok-ghost')).rejects.toMatchObject({
      response: { error: { code: 'LINK_NOT_AVAILABLE' } },
    });
  });
});
