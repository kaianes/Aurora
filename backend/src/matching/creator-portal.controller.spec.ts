import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CreatorPortalController } from './creator-portal.controller';

// E8 / ADR-0050: the former login stub this file used to cover was removed
// from this controller (real creator login now lives in creator-network).
// The opportunities endpoints below depend only on CreatorAuthGuard and the
// JWT's creator_id claim, unchanged by that replacement.
describe('CreatorPortalController - US-28 opportunities', () => {
  let controller: CreatorPortalController;
  let opportunityService: { listForCreator: ReturnType<typeof vi.fn>; accept: ReturnType<typeof vi.fn>; decline: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    opportunityService = { listForCreator: vi.fn(), accept: vi.fn(), decline: vi.fn() };

    controller = new CreatorPortalController(opportunityService as any);
  });

  // Normal: the authenticated creator's own opportunities list is requested using the JWT's creator_id claim.
  it('lists opportunities scoped to the authenticated creator from the JWT claim', async () => {
    opportunityService.listForCreator.mockResolvedValue({ data: [] });

    await controller.list({ creatorId: 'creator-9001' });

    expect(opportunityService.listForCreator).toHaveBeenCalledWith('creator-9001');
  });
});
