import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { CreatorPortalController } from './creator-portal.controller';

describe('CreatorPortalController - US-28 (login stub, ADR-0013)', () => {
  let controller: CreatorPortalController;
  let opportunityService: { listForCreator: ReturnType<typeof vi.fn>; accept: ReturnType<typeof vi.fn>; decline: ReturnType<typeof vi.fn> };
  let jwtService: { sign: ReturnType<typeof vi.fn> };
  let creatorRepo: { findOne: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    opportunityService = { listForCreator: vi.fn(), accept: vi.fn(), decline: vi.fn() };
    jwtService = { sign: vi.fn().mockReturnValue('signed-jwt') };
    creatorRepo = { findOne: vi.fn() };

    controller = new CreatorPortalController(
      opportunityService as any,
      jwtService as any,
      creatorRepo as any,
    );
  });

  // Normal: a pilot login for an existing creator issues a creator-scoped JWT with no password.
  it('issues a creator-scoped JWT for an existing creator id', async () => {
    creatorRepo.findOne.mockResolvedValue({ id: 'creator-9001' });

    const result = await controller.login({ creator_id: 'creator-9001' });

    expect(jwtService.sign).toHaveBeenCalledWith(
      { sub: 'creator-9001', creator_id: 'creator-9001' },
      { expiresIn: '15m' },
    );
    expect(result).toEqual({ access_token: 'signed-jwt', expires_in: 900, creator_id: 'creator-9001' });
  });

  // Failure: logging in with an id that does not correspond to any creator row is a clean 404,
  // not a silently-issued token for a nonexistent creator.
  it('rejects login for a creator id that does not exist', async () => {
    creatorRepo.findOne.mockResolvedValue(null);

    await expect(controller.login({ creator_id: 'creator-ghost' })).rejects.toThrow(NotFoundException);
    expect(jwtService.sign).not.toHaveBeenCalled();
  });

  // Normal: the authenticated creator's own opportunities list is requested using the JWT's creator_id claim.
  it('lists opportunities scoped to the authenticated creator from the JWT claim', async () => {
    opportunityService.listForCreator.mockResolvedValue({ data: [] });

    await controller.list({ creatorId: 'creator-9001' });

    expect(opportunityService.listForCreator).toHaveBeenCalledWith('creator-9001');
  });
});
