import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { MonitoringService } from './monitoring.service';
import { MonitoringResult } from '../database/entities';

const mockRepo = () => ({
  findOne: vi.fn(),
  createQueryBuilder: vi.fn(),
});

function mockQb(getMany: any[] = [], getOne: any = null) {
  return {
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    getMany: vi.fn().mockResolvedValue(getMany),
    getOne: vi.fn().mockResolvedValue(getOne),
  };
}

describe('MonitoringService - US-16b', () => {
  let service: MonitoringService;
  let snapshotRepo: ReturnType<typeof mockRepo>;
  let submissionRepo: ReturnType<typeof mockRepo>;

  beforeEach(() => {
    snapshotRepo = mockRepo();
    submissionRepo = mockRepo();
    service = new MonitoringService(snapshotRepo as any, submissionRepo as any);
  });

  // US-16b scenario 1: a published post that still matches needs no action and carries no
  // deviation details or unreachable count.
  it('lists a matching snapshot with no deviation details and no unreachable count', async () => {
    const snapshot = {
      id: 'snap-001',
      contentSubmissionId: 'sub-5001',
      publishedUrl: 'https://instagram.com/p/abc123',
      lastResult: MonitoringResult.MATCHING,
      lastCheckedAt: new Date(),
      deviationDetails: null,
      consecutiveUnreachableCount: 0,
    };
    snapshotRepo.createQueryBuilder.mockReturnValue(mockQb([snapshot]));
    submissionRepo.findOne.mockResolvedValue({ id: 'sub-5001', campaignId: 'camp-1234' });

    const result = await service.list('account-1');

    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      last_result: 'matching',
      campaign_id: 'camp-1234',
      deviation_details: null,
    });
    expect(result.data[0].consecutive_unreachable_count).toBeUndefined();
  });

  // US-16b scenario 2: a deviated snapshot states what changed, not just "a difference exists."
  it('lists a deviated snapshot with the specific field and both values', async () => {
    const snapshot = {
      id: 'snap-001',
      contentSubmissionId: 'sub-5001',
      publishedUrl: 'https://instagram.com/p/abc123',
      lastResult: MonitoringResult.DEVIATED,
      lastCheckedAt: new Date(),
      deviationDetails: {
        field: 'caption_text',
        approved: 'Esse serum mudou minha pele em 14 dias!',
        current: 'Esse serum mudou minha pele em 14 dias! Link na bio com desconto de 70%',
      },
      consecutiveUnreachableCount: 0,
    };
    snapshotRepo.createQueryBuilder.mockReturnValue(mockQb([snapshot]));
    submissionRepo.findOne.mockResolvedValue({ id: 'sub-5001', campaignId: 'camp-1234' });

    const result = await service.list('account-1');

    expect(result.data[0].last_result).toBe('deviated');
    expect(result.data[0].deviation_details).toMatchObject({
      field: 'caption_text',
      approved: expect.any(String),
      current: expect.any(String),
    });
  });

  // US-16b scenario 3: an unreachable/removed post is distinguishable from a deviated one and is
  // never reported as matching simply because there is nothing left to compare. The consecutive
  // unreachable count is surfaced only for this result.
  it('lists an unreachable snapshot distinctly from deviated, with the consecutive count surfaced', async () => {
    const snapshot = {
      id: 'snap-002',
      contentSubmissionId: 'sub-5002',
      publishedUrl: 'https://instagram.com/p/def456',
      lastResult: MonitoringResult.UNREACHABLE,
      lastCheckedAt: new Date(),
      deviationDetails: { reason: 'link_unreachable_or_removed' },
      consecutiveUnreachableCount: 2,
    };
    snapshotRepo.createQueryBuilder.mockReturnValue(mockQb([snapshot]));
    submissionRepo.findOne.mockResolvedValue({ id: 'sub-5002', campaignId: 'camp-1234' });

    const result = await service.list('account-1');

    expect(result.data[0].last_result).toBe('unreachable');
    expect(result.data[0].last_result).not.toBe('matching');
    expect(result.data[0].deviation_details).toEqual({ reason: 'link_unreachable_or_removed' });
    expect(result.data[0].consecutive_unreachable_count).toBe(2);
  });

  it('includes the approved baseline fields in a single snapshot detail', async () => {
    const snapshot = {
      id: 'snap-001',
      contentSubmissionId: 'sub-5001',
      publishedUrl: 'https://instagram.com/p/abc123',
      lastResult: MonitoringResult.MATCHING,
      lastCheckedAt: new Date(),
      deviationDetails: null,
      consecutiveUnreachableCount: 0,
      approvedCaptionText: 'texto aprovado',
      approvedOnScreenText: null,
      approvedAudioTranscript: null,
    };
    snapshotRepo.createQueryBuilder.mockReturnValue(mockQb([], snapshot));
    submissionRepo.findOne.mockResolvedValue({ id: 'sub-5001', campaignId: 'camp-1234' });

    const result = await service.getDetail('snap-001', 'account-1');

    expect(result.approved_caption_text).toBe('texto aprovado');
  });

  it('throws NotFoundException for a snapshot outside the current account', async () => {
    snapshotRepo.createQueryBuilder.mockReturnValue(mockQb([], null));
    await expect(service.getDetail('missing', 'account-1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
