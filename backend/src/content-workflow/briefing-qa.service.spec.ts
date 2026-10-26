import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { BriefingQaService } from './briefing-qa.service';
import { BriefingStatus, OpportunityStatus, QaSenderType } from '../database/entities';

const mockRepo = () => ({
  findOne: vi.fn(),
  find: vi.fn().mockResolvedValue([]),
  create: vi.fn((data: any) => ({ ...data })),
  save: vi.fn((entity: any) =>
    Promise.resolve({ id: entity.id || 'id-' + Math.random(), createdAt: new Date(), ...entity }),
  ),
});

const actor = { ipAddress: '127.0.0.1', userAgent: 'vitest' };

describe('BriefingQaService - US-30/US-31', () => {
  let service: BriefingQaService;
  let briefingRepo: ReturnType<typeof mockRepo>;
  let opportunityRepo: ReturnType<typeof mockRepo>;
  let threadRepo: ReturnType<typeof mockRepo>;
  let messageRepo: ReturnType<typeof mockRepo>;
  let campaignRepo: ReturnType<typeof mockRepo>;
  let creatorRepo: ReturnType<typeof mockRepo>;
  let auditService: { log: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    briefingRepo = mockRepo();
    opportunityRepo = mockRepo();
    threadRepo = mockRepo();
    messageRepo = mockRepo();
    campaignRepo = mockRepo();
    creatorRepo = mockRepo();
    auditService = { log: vi.fn().mockResolvedValue(undefined) };

    service = new BriefingQaService(
      briefingRepo as any,
      opportunityRepo as any,
      threadRepo as any,
      messageRepo as any,
      campaignRepo as any,
      creatorRepo as any,
      auditService as any,
    );
  });

  describe('getBriefingForCreator', () => {
    it('returns BRIEFING_NOT_AVAILABLE uniformly for a declined/expired opportunity (US-30 scenario 3)', async () => {
      briefingRepo.findOne.mockResolvedValue({ id: 'brf-1', campaignId: 'camp-1', status: BriefingStatus.ISSUED });
      opportunityRepo.findOne.mockResolvedValue(undefined);

      await expect(service.getBriefingForCreator('camp-1', 'creator-1')).rejects.toMatchObject({
        response: { error: { code: 'BRIEFING_NOT_AVAILABLE' } },
      });
    });

    it('returns BRIEFING_NOT_AVAILABLE for a briefing that has not been issued yet', async () => {
      briefingRepo.findOne.mockResolvedValue({ id: 'brf-1', campaignId: 'camp-1', status: BriefingStatus.DRAFT });
      await expect(service.getBriefingForCreator('camp-1', 'creator-1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('renders the full briefing when the creator holds an accepted opportunity', async () => {
      briefingRepo.findOne.mockResolvedValue({
        id: 'brf-1',
        campaignId: 'camp-1',
        status: BriefingStatus.ISSUED,
        dos: ['do 1'],
        donts: ['dont 1'],
        referenceExamples: ['ex 1'],
        deliverableSpec: { format: 'instagram_reel' },
        deadline: new Date('2026-11-05T23:59:59Z'),
        issuedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      opportunityRepo.findOne.mockResolvedValue({ id: 'opp-1', status: OpportunityStatus.ACCEPTED });

      const result = await service.getBriefingForCreator('camp-1', 'creator-1');
      expect(result.dos).toEqual(['do 1']);
      expect((result as any).issued_by_user_id).toBeUndefined();
    });
  });

  describe('askQuestion / getOwnThread', () => {
    const issuedBriefing = { id: 'brf-1', campaignId: 'camp-1', status: BriefingStatus.ISSUED };

    it('lazily creates a thread on the first question and records it as creator-sent', async () => {
      briefingRepo.findOne.mockResolvedValue(issuedBriefing);
      opportunityRepo.findOne.mockResolvedValue({ id: 'opp-1', status: OpportunityStatus.ACCEPTED });
      threadRepo.findOne.mockResolvedValue(undefined);

      const result = await service.askQuestion('camp-1', 'creator-1', 'Precisa de audio?', actor);

      expect(threadRepo.save).toHaveBeenCalled();
      expect(result.sender_type).toBe(QaSenderType.CREATOR);
      expect(result.body).toBe('Precisa de audio?');
      expect(auditService.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'briefing_qa.question_asked' }));
    });

    it('keeps an unanswered question visibly recorded, not disappearing (US-31 scenario 3)', async () => {
      briefingRepo.findOne.mockResolvedValue(issuedBriefing);
      opportunityRepo.findOne.mockResolvedValue({ id: 'opp-1', status: OpportunityStatus.ACCEPTED });
      threadRepo.findOne.mockResolvedValue({ id: 'thr-1', briefingId: 'brf-1', creatorId: 'creator-1' });
      messageRepo.find.mockResolvedValue([
        { senderType: QaSenderType.CREATOR, body: 'Precisa de audio?', createdAt: new Date() },
      ]);

      const result = await service.getOwnThread('camp-1', 'creator-1');
      expect(result.thread_id).toBe('thr-1');
      expect(result.answered).toBe(false);
      expect(result.messages).toHaveLength(1);
    });

    it('returns a null thread (not 404) when the creator never asked a question', async () => {
      briefingRepo.findOne.mockResolvedValue(issuedBriefing);
      opportunityRepo.findOne.mockResolvedValue({ id: 'opp-1', status: OpportunityStatus.ACCEPTED });
      threadRepo.findOne.mockResolvedValue(undefined);

      const result = await service.getOwnThread('camp-1', 'creator-1');
      expect(result).toEqual({ thread_id: null, messages: [], answered: null });
    });
  });

  describe('privacy between creators (US-31 scenario 2)', () => {
    it('never returns another creator thread for a given (briefing, creator) lookup', async () => {
      // threadRepo.findOne is always called with { briefingId, creatorId } -- the structural
      // guarantee ADR-0028 relies on. Simulating creator-2's own empty result proves creator-1's
      // thread is never implicitly reachable from creator-2's call.
      briefingRepo.findOne.mockResolvedValue({ id: 'brf-1', campaignId: 'camp-1', status: BriefingStatus.ISSUED });
      opportunityRepo.findOne.mockResolvedValue({ id: 'opp-2', status: OpportunityStatus.ACCEPTED });
      threadRepo.findOne.mockImplementation(({ where }: any) =>
        Promise.resolve(where.creatorId === 'creator-1' ? { id: 'thr-1', creatorId: 'creator-1' } : undefined),
      );

      const result = await service.getOwnThread('camp-1', 'creator-2');
      expect(result.thread_id).toBeNull();
    });
  });

  describe('brand side', () => {
    beforeEach(() => {
      campaignRepo.findOne.mockResolvedValue({ id: 'camp-1', accountId: 'account-1' });
    });

    it('lists one row per creator thread, with answered computed at read time', async () => {
      briefingRepo.findOne.mockResolvedValue({ id: 'brf-1', campaignId: 'camp-1' });
      threadRepo.find.mockResolvedValue([{ id: 'thr-1', creatorId: 'creator-1', createdAt: new Date() }]);
      messageRepo.find.mockResolvedValue([
        { senderType: QaSenderType.CREATOR, body: 'q', createdAt: new Date('2026-10-21T09:00:00Z') },
      ]);
      creatorRepo.findOne.mockResolvedValue({ displayName: 'Duda Oliveira' });

      const result = await service.listThreads('camp-1', 'account-1');
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({ creator_display_name: 'Duda Oliveira', answered: false, message_count: 1 });
    });

    it('answers a question and makes it visible on the same thread', async () => {
      threadRepo.findOne.mockResolvedValue({ id: 'thr-1', campaignId: 'camp-1', creatorId: 'creator-1' });

      const result = await service.answerQuestion('camp-1', 'thr-1', 'account-1', 'Funciona com legenda.', {
        userId: 'user-1',
        ...actor,
      });

      expect(result.sender_type).toBe(QaSenderType.BRAND);
      expect(result.body).toBe('Funciona com legenda.');
      expect(auditService.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'briefing_qa.answered' }));
    });

    it('throws THREAD_NOT_FOUND for a thread outside the caller account scope', async () => {
      threadRepo.findOne.mockResolvedValue(undefined);
      await expect(
        service.getThreadDetail('camp-1', 'thr-999', 'account-1'),
      ).rejects.toMatchObject({ response: { error: { code: 'THREAD_NOT_FOUND' } } });
    });
  });
});
