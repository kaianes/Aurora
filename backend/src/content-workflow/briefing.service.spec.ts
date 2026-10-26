import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { BriefingService } from './briefing.service';
import { BriefingStatus } from '../database/entities';

const mockRepo = () => ({
  findOne: vi.fn(),
  find: vi.fn().mockResolvedValue([]),
  create: vi.fn((data: any) => ({ ...data })),
  save: vi.fn((entity: any) =>
    Array.isArray(entity)
      ? Promise.resolve(entity.map((e) => ({ id: e.id || 'id-' + Math.random(), createdAt: new Date(), ...e })))
      : Promise.resolve({ id: entity.id || 'id-' + Math.random(), createdAt: new Date(), updatedAt: new Date(), ...entity }),
  ),
});

const actor = { userId: 'user-1', ipAddress: '127.0.0.1', userAgent: 'vitest' };

describe('BriefingService - US-18a/US-18b', () => {
  let service: BriefingService;
  let campaignRepo: ReturnType<typeof mockRepo>;
  let briefingRepo: ReturnType<typeof mockRepo>;
  let opportunityRepo: ReturnType<typeof mockRepo>;
  let recipientRepo: ReturnType<typeof mockRepo>;
  let queue: { add: ReturnType<typeof vi.fn> };
  let auditService: { log: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    campaignRepo = mockRepo();
    briefingRepo = mockRepo();
    opportunityRepo = mockRepo();
    recipientRepo = mockRepo();
    queue = { add: vi.fn().mockResolvedValue(undefined) };
    auditService = { log: vi.fn().mockResolvedValue(undefined) };
    campaignRepo.findOne.mockResolvedValue({ id: 'camp-1', accountId: 'account-1' });

    service = new BriefingService(
      campaignRepo as any,
      briefingRepo as any,
      opportunityRepo as any,
      recipientRepo as any,
      queue as any,
      auditService as any,
    );
  });

  describe('getBriefing', () => {
    it('throws BRIEFING_NOT_FOUND when Marina has never saved a draft', async () => {
      briefingRepo.findOne.mockResolvedValue(undefined);
      await expect(service.getBriefing('camp-1', 'account-1')).rejects.toMatchObject({
        response: { error: { code: 'BRIEFING_NOT_FOUND' } },
      });
    });
  });

  describe('upsertBriefing', () => {
    it('lazily creates a draft briefing on first save (US-18a scenario 2)', async () => {
      briefingRepo.findOne.mockResolvedValue(undefined);
      const result = await service.upsertBriefing('camp-1', 'account-1', { dos: ['Fazer X'] }, actor);
      expect(result.status).toBe(BriefingStatus.DRAFT);
      expect(result.dos).toEqual(['Fazer X']);
    });

    it('merges only the fields provided, leaving omitted fields untouched', async () => {
      briefingRepo.findOne.mockResolvedValue({
        id: 'brf-1',
        campaignId: 'camp-1',
        status: BriefingStatus.DRAFT,
        dos: ['existing do'],
        donts: ['existing dont'],
        referenceExamples: null,
        deliverableSpec: null,
        deadline: null,
        issuedAt: null,
        issuedByUserId: null,
        createdByUserId: 'user-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const result = await service.upsertBriefing('camp-1', 'account-1', { donts: ['new dont'] }, actor);
      expect(result.dos).toEqual(['existing do']);
      expect(result.donts).toEqual(['new dont']);
    });

    it('refuses to edit an already-issued briefing with 409 BRIEFING_ALREADY_ISSUED', async () => {
      briefingRepo.findOne.mockResolvedValue({ id: 'brf-1', campaignId: 'camp-1', status: BriefingStatus.ISSUED });
      await expect(service.upsertBriefing('camp-1', 'account-1', { dos: ['x'] }, actor)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('issueBriefing', () => {
    const completeBriefing = {
      id: 'brf-1',
      campaignId: 'camp-1',
      status: BriefingStatus.DRAFT,
      dos: ['do 1'],
      donts: ['dont 1'],
      referenceExamples: ['example 1'],
      deliverableSpec: { format: 'instagram_reel' },
      deadline: new Date('2026-11-05T23:59:59Z'),
      issuedAt: null,
      issuedByUserId: null,
    };

    it('refuses to issue an incomplete briefing and sends nothing (US-18a scenario 3)', async () => {
      briefingRepo.findOne.mockResolvedValue({ ...completeBriefing, deadline: null, referenceExamples: [] });
      await expect(service.issueBriefing('camp-1', 'account-1', actor)).rejects.toMatchObject({
        response: { error: { code: 'BRIEFING_INCOMPLETE', details: { missing_fields: ['reference_examples', 'deadline'] } } },
      });
      expect(opportunityRepo.find).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('treats a never-saved briefing as every field missing rather than a 404', async () => {
      briefingRepo.findOne.mockResolvedValue(undefined);
      await expect(service.issueBriefing('camp-1', 'account-1', actor)).rejects.toMatchObject({
        response: { error: { code: 'BRIEFING_INCOMPLETE' } },
      });
    });

    it('issues a complete briefing, reaching every creator currently in the pool (US-18b scenario 1/2)', async () => {
      briefingRepo.findOne.mockResolvedValue({ ...completeBriefing });
      opportunityRepo.find.mockResolvedValue([
        { id: 'opp-1', creatorId: 'creator-1', campaignId: 'camp-1' },
        { id: 'opp-2', creatorId: 'creator-2', campaignId: 'camp-1' },
      ]);

      const result = await service.issueBriefing('camp-1', 'account-1', actor);

      expect(result.status).toBe(BriefingStatus.ISSUED);
      expect(result.recipients_queued).toBe(2);
      expect(recipientRepo.save).toHaveBeenCalled();
      expect(queue.add).toHaveBeenCalledWith('distribute-briefing', expect.objectContaining({ briefingId: 'brf-1' }));
    });

    it('refuses to re-issue an already-issued briefing', async () => {
      briefingRepo.findOne.mockResolvedValue({ ...completeBriefing, status: BriefingStatus.ISSUED });
      await expect(service.issueBriefing('camp-1', 'account-1', actor)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('getDistribution', () => {
    it('reports failed recipients explicitly, never collapsing a partial failure into success (US-18b scenario 3)', async () => {
      briefingRepo.findOne.mockResolvedValue({ id: 'brf-1', campaignId: 'camp-1' });
      recipientRepo.find.mockResolvedValue([
        { creatorId: 'creator-1', status: 'delivered', failureReason: null },
        { creatorId: 'creator-2', status: 'failed', failureReason: 'no_contact_channel' },
        { creatorId: 'creator-3', status: 'pending', failureReason: null },
      ]);

      const result = await service.getDistribution('camp-1', 'account-1');
      expect(result.recipients_total).toBe(3);
      expect(result.delivered).toBe(1);
      expect(result.failed).toEqual([{ creator_id: 'creator-2', failure_reason: 'no_contact_channel' }]);
      expect(result.pending).toBe(1);
    });

    it('throws BRIEFING_NOT_FOUND when no briefing was ever saved', async () => {
      briefingRepo.findOne.mockResolvedValue(undefined);
      await expect(service.getDistribution('camp-1', 'account-1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
