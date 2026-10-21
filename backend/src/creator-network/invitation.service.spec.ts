import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictException, GoneException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InvitationService } from './invitation.service';
import { CreatorInvitationStatus, CreatorStatus } from '../database/entities';

const mockRepo = () => ({
  findOne: vi.fn(),
  find: vi.fn(),
  create: vi.fn((data: any) => ({ id: 'generated-id', ...data })),
  save: vi.fn((entity: any) => Promise.resolve(entity)),
  delete: vi.fn().mockResolvedValue({ affected: 1 }),
});

const mockQueryRunner = {
  connect: vi.fn(),
  startTransaction: vi.fn(),
  commitTransaction: vi.fn(),
  rollbackTransaction: vi.fn(),
  release: vi.fn(),
  isTransactionActive: true,
  manager: {
    findOne: vi.fn(),
    create: vi.fn((_E: any, data: any) => ({ ...data })),
    save: vi.fn((entity: any) => Promise.resolve(entity)),
  },
};

describe('InvitationService - US-23.2', () => {
  let service: InvitationService;
  let creatorRepo: ReturnType<typeof mockRepo>;
  let invitationRepo: ReturnType<typeof mockRepo>;
  let publicImportRepo: ReturnType<typeof mockRepo>;
  let authService: { createUser: ReturnType<typeof vi.fn>; issueVerificationToken: ReturnType<typeof vi.fn>; enqueueVerificationEmail: ReturnType<typeof vi.fn> };
  let auditService: { log: ReturnType<typeof vi.fn> };
  let jwtService: { sign: ReturnType<typeof vi.fn> };
  let emailQueue: { add: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    creatorRepo = mockRepo();
    invitationRepo = mockRepo();
    publicImportRepo = mockRepo();
    authService = {
      createUser: vi.fn(),
      issueVerificationToken: vi.fn().mockResolvedValue('verify-token'),
      enqueueVerificationEmail: vi.fn().mockResolvedValue(undefined),
    };
    auditService = { log: vi.fn().mockResolvedValue(undefined) };
    jwtService = { sign: vi.fn().mockReturnValue('signed-jwt') };
    emailQueue = { add: vi.fn().mockResolvedValue(undefined) };

    mockQueryRunner.isTransactionActive = true;
    Object.values(mockQueryRunner).forEach((fn) => {
      if (typeof fn === 'function') (fn as any).mockClear?.();
    });
    Object.values(mockQueryRunner.manager).forEach((fn) => (fn as any).mockClear?.());
    mockQueryRunner.manager.create.mockImplementation((_E: any, data: any) => ({ ...data }));
    mockQueryRunner.manager.save.mockImplementation((entity: any) => Promise.resolve(entity));

    const dataSource = { createQueryRunner: () => mockQueryRunner };
    const configService = { get: vi.fn().mockReturnValue('http://localhost:3000') };

    service = new InvitationService(
      creatorRepo as any,
      invitationRepo as any,
      publicImportRepo as any,
      dataSource as any,
      authService as any,
      auditService as any,
      jwtService as any,
      configService as any,
      emailQueue as any,
    );
  });

  describe('dispatchInvitation', () => {
    it('creates a pending invitation and enqueues an email', async () => {
      creatorRepo.findOne.mockResolvedValue({ id: 'creator-1', status: CreatorStatus.UNCLAIMED, displayName: 'Duda' });
      invitationRepo.findOne.mockResolvedValue(null);

      const result = await service.dispatchInvitation(
        'creator-1',
        { contact_email: 'duda@example.com' },
        'operator-1',
        { ipAddress: '127.0.0.1', userAgent: 'test' },
      );

      expect(result.status).toBe('pending');
      expect(emailQueue.add).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'creator_invitation.created' }),
      );
    });

    it('404s when the creator does not exist or is not unclaimed', async () => {
      creatorRepo.findOne.mockResolvedValue(null);

      await expect(
        service.dispatchInvitation('creator-x', { contact_email: 'a@b.com' }, 'operator-1', {
          ipAddress: '',
          userAgent: '',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('409s when an unresolved invitation already exists', async () => {
      creatorRepo.findOne.mockResolvedValue({ id: 'creator-1', status: CreatorStatus.UNCLAIMED });
      invitationRepo.findOne.mockResolvedValue({ id: 'inv-1', status: CreatorInvitationStatus.PENDING });

      await expect(
        service.dispatchInvitation('creator-1', { contact_email: 'a@b.com' }, 'operator-1', {
          ipAddress: '',
          userAgent: '',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('previewInvitation', () => {
    it('returns the imported data for a pending, unexpired invitation', async () => {
      invitationRepo.findOne.mockResolvedValue({
        id: 'inv-1',
        creatorId: 'creator-1',
        status: CreatorInvitationStatus.PENDING,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      });
      creatorRepo.findOne.mockResolvedValue({ id: 'creator-1', displayName: 'Duda Oliveira' });
      publicImportRepo.findOne.mockResolvedValue({
        platform: 'instagram',
        observedHandle: '@duda.oliveira',
        observedFollowerCount: 8400,
        observedNiche: 'beleza e skincare',
      });

      const result = await service.previewInvitation('tok-1');

      expect(result.imported_data.display_name).toBe('Duda Oliveira');
      expect(result.imported_data.observed_follower_count).toBe(8400);
    });

    it('404s for an unknown token', async () => {
      invitationRepo.findOne.mockResolvedValue(null);
      await expect(service.previewInvitation('ghost')).rejects.toThrow(NotFoundException);
    });

    it('410s for an already-accepted invitation', async () => {
      invitationRepo.findOne.mockResolvedValue({
        status: CreatorInvitationStatus.ACCEPTED,
        expiresAt: new Date(Date.now() + 100000),
      });
      await expect(service.previewInvitation('tok-1')).rejects.toThrow(GoneException);
    });
  });

  describe('confirmClaim', () => {
    const baseInvitation = () => ({
      id: 'inv-1',
      creatorId: 'creator-1',
      status: CreatorInvitationStatus.PENDING,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
    });

    const confirmDto = {
      email: 'duda@gmail.com',
      password: 'StrongP@ss1',
      corrections: { display_name: 'Duda M. Oliveira', content_niche: 'skincare e maquiagem' },
      accepted_terms: true,
      terms_version: '2026-10-01',
    };

    it('scenario 1/2: activates the profile with her corrections as authoritative, not merged', async () => {
      invitationRepo.findOne.mockResolvedValue(baseInvitation());
      authService.createUser.mockResolvedValue({ user: { id: 'user-1', email: 'duda@gmail.com', name: 'Duda M. Oliveira' }, isNew: true });
      mockQueryRunner.manager.findOne.mockResolvedValue({
        id: 'creator-1',
        displayName: 'Duda Oliveira',
        contentNiche: 'beleza',
      });

      const result = await service.confirmClaim('tok-1', confirmDto);

      expect(result.status).toBe('active');
      expect(result.access_token).toBe('signed-jwt');

      const savedCreatorCall = mockQueryRunner.manager.save.mock.calls.find(
        (call) => call[0]?.displayName !== undefined,
      )!;
      expect(savedCreatorCall[0].displayName).toBe('Duda M. Oliveira');
      expect(savedCreatorCall[0].contentNiche).toBe('skincare e maquiagem');
      expect(savedCreatorCall[0].status).toBe('active');
      expect(savedCreatorCall[0].unclaimedExpiresAt).toBeNull();
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
    });

    it('keeps unspecified fields at their existing (imported) value -- never merged, never blanked', async () => {
      invitationRepo.findOne.mockResolvedValue(baseInvitation());
      authService.createUser.mockResolvedValue({ user: { id: 'user-1', email: 'duda@gmail.com', name: 'Duda' }, isNew: true });
      mockQueryRunner.manager.findOne.mockResolvedValue({
        id: 'creator-1',
        displayName: 'Duda Oliveira',
        contentNiche: 'beleza',
      });

      await service.confirmClaim('tok-1', { ...confirmDto, corrections: { display_name: 'Duda Corrigida' } });

      const savedCreatorCall = mockQueryRunner.manager.save.mock.calls.find(
        (call) => call[0]?.displayName !== undefined,
      )!;
      expect(savedCreatorCall[0].displayName).toBe('Duda Corrigida');
      expect(savedCreatorCall[0].contentNiche).toBe('beleza'); // untouched
    });

    it('422s with EMAIL_ALREADY_REGISTERED when the email already belongs to a user', async () => {
      invitationRepo.findOne.mockResolvedValue(baseInvitation());
      authService.createUser.mockResolvedValue({ user: { id: 'existing-user' }, isNew: false });

      await expect(service.confirmClaim('tok-1', confirmDto)).rejects.toThrow(UnprocessableEntityException);
      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
    });

    it('rejects when terms are not accepted', async () => {
      invitationRepo.findOne.mockResolvedValue(baseInvitation());

      await expect(
        service.confirmClaim('tok-1', { ...confirmDto, accepted_terms: false }),
      ).rejects.toThrow();
    });

    it('410s on a genuinely expired invitation, 409s on an already-resolved one', async () => {
      invitationRepo.findOne.mockResolvedValueOnce({
        status: CreatorInvitationStatus.PENDING,
        expiresAt: new Date(Date.now() - 1000),
      });
      await expect(service.confirmClaim('tok-expired', confirmDto)).rejects.toThrow(GoneException);

      invitationRepo.findOne.mockResolvedValueOnce({
        status: CreatorInvitationStatus.ACCEPTED,
        expiresAt: new Date(Date.now() + 100000),
      });
      await expect(service.confirmClaim('tok-resolved', confirmDto)).rejects.toThrow(ConflictException);
    });
  });

  describe('declineInvitation', () => {
    it('scenario 3: records the decline, audits before deleting, then hard-deletes the creator', async () => {
      invitationRepo.findOne.mockResolvedValue({
        id: 'inv-1',
        creatorId: 'creator-1',
        status: CreatorInvitationStatus.PENDING,
        expiresAt: new Date(Date.now() + 100000),
      });

      const result = await service.declineInvitation('tok-1', { ipAddress: '127.0.0.1', userAgent: 'test' });

      expect(result.status).toBe('declined');
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'creator.invitation_declined' }),
      );
      expect(creatorRepo.delete).toHaveBeenCalledWith({ id: 'creator-1' });

      // The audit log call must happen before the delete call.
      const auditCallOrder = auditService.log.mock.invocationCallOrder[0];
      const deleteCallOrder = creatorRepo.delete.mock.invocationCallOrder[0];
      expect(auditCallOrder).toBeLessThan(deleteCallOrder);
    });
  });
});
