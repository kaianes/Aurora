import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { BrandSafetyGateService } from './brand-safety-gate.service';
import { ReviewItemStatus, SafetyCheckStatus } from '../database/entities';

const mockRepo = () => ({
  findOne: vi.fn(),
  save: vi.fn((entity: any) => Promise.resolve({ id: entity.id || 'snap-1', ...entity })),
  create: vi.fn((data: any) => ({ ...data })),
});

describe('BrandSafetyGateService - section 2.8 / US-16 scenario 3', () => {
  let service: BrandSafetyGateService;
  let submissionRepo: ReturnType<typeof mockRepo>;
  let checkRepo: ReturnType<typeof mockRepo>;
  let reviewRepo: ReturnType<typeof mockRepo>;
  let snapshotRepo: ReturnType<typeof mockRepo>;

  beforeEach(() => {
    submissionRepo = mockRepo();
    checkRepo = mockRepo();
    reviewRepo = mockRepo();
    snapshotRepo = mockRepo();
    service = new BrandSafetyGateService(
      submissionRepo as any,
      checkRepo as any,
      reviewRepo as any,
      snapshotRepo as any,
    );
  });

  it('is blocked, pending, when no check exists yet', async () => {
    checkRepo.findOne.mockResolvedValue(undefined);
    const status = await service.getGateStatus('sub-1');
    expect(status).toEqual({ cleared: false, blockingReason: 'pending' });
  });

  it('is blocked, pending, while the check is still pending', async () => {
    checkRepo.findOne.mockResolvedValue({ id: 'chk-1', status: SafetyCheckStatus.PENDING });
    const status = await service.getGateStatus('sub-1');
    expect(status).toEqual({ cleared: false, blockingReason: 'pending' });
  });

  it('is cleared when the check passed', async () => {
    checkRepo.findOne.mockResolvedValue({ id: 'chk-1', status: SafetyCheckStatus.PASSED });
    const status = await service.getGateStatus('sub-1');
    expect(status).toEqual({ cleared: true, blockingReason: null });
  });

  it('is blocked, flagged, when flagged and the review item is still pending', async () => {
    checkRepo.findOne.mockResolvedValue({ id: 'chk-1', status: SafetyCheckStatus.FLAGGED });
    reviewRepo.findOne.mockResolvedValue({ status: ReviewItemStatus.PENDING });
    const status = await service.getGateStatus('sub-1');
    expect(status).toEqual({ cleared: false, blockingReason: 'flagged' });
  });

  it('is cleared when flagged but the review was approved (human override)', async () => {
    checkRepo.findOne.mockResolvedValue({ id: 'chk-1', status: SafetyCheckStatus.FLAGGED });
    reviewRepo.findOne.mockResolvedValue({ status: ReviewItemStatus.APPROVED });
    const status = await service.getGateStatus('sub-1');
    expect(status).toEqual({ cleared: true, blockingReason: null });
  });

  it('is blocked, rejected, permanently when the review rejected the flagged item', async () => {
    checkRepo.findOne.mockResolvedValue({ id: 'chk-1', status: SafetyCheckStatus.FLAGGED });
    reviewRepo.findOne.mockResolvedValue({ status: ReviewItemStatus.REJECTED });
    const status = await service.getGateStatus('sub-1');
    expect(status).toEqual({ cleared: false, blockingReason: 'rejected' });
  });

  it('is blocked, check_unavailable, when the check timed out and review is pending', async () => {
    checkRepo.findOne.mockResolvedValue({ id: 'chk-1', status: SafetyCheckStatus.CHECK_UNAVAILABLE });
    reviewRepo.findOne.mockResolvedValue(undefined);
    const status = await service.getGateStatus('sub-1');
    expect(status).toEqual({ cleared: false, blockingReason: 'check_unavailable' });
  });

  // US-16 scenario 3: refuses the publication action outright when the
  // content has not passed, regardless of who or what initiates the attempt.
  it('recordPublication refuses with 409 SAFETY_NOT_CLEARED when no passing verdict exists', async () => {
    submissionRepo.findOne.mockResolvedValue({ id: 'sub-1', captionText: 'caption' });
    checkRepo.findOne.mockResolvedValue({ id: 'chk-1', status: SafetyCheckStatus.PENDING });

    await expect(service.recordPublication('sub-1', 'https://instagram.com/p/abc')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(snapshotRepo.save).not.toHaveBeenCalled();
  });

  it('recordPublication refuses when the submission was flagged and never approved', async () => {
    submissionRepo.findOne.mockResolvedValue({ id: 'sub-1', captionText: 'caption' });
    checkRepo.findOne.mockResolvedValue({ id: 'chk-1', status: SafetyCheckStatus.FLAGGED });
    reviewRepo.findOne.mockResolvedValue({ status: ReviewItemStatus.PENDING });

    await expect(service.recordPublication('sub-1', 'https://instagram.com/p/abc')).rejects.toMatchObject({
      response: { error: { code: 'SAFETY_NOT_CLEARED' } },
    });
  });

  it('recordPublication throws NotFoundException for an unknown submission', async () => {
    submissionRepo.findOne.mockResolvedValue(undefined);
    await expect(service.recordPublication('missing', 'https://x.com')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('recordPublication creates a snapshot once the gate is cleared', async () => {
    submissionRepo.findOne.mockResolvedValue({
      id: 'sub-1',
      captionText: 'caption aprovada',
      onScreenText: 'texto na tela',
      audioTranscript: null,
    });
    checkRepo.findOne.mockResolvedValue({ id: 'chk-1', status: SafetyCheckStatus.PASSED });
    snapshotRepo.findOne.mockResolvedValue(undefined);

    await service.recordPublication('sub-1', 'https://instagram.com/p/abc');

    expect(snapshotRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        publishedUrl: 'https://instagram.com/p/abc',
        approvedCaptionText: 'caption aprovada',
        approvedOnScreenText: 'texto na tela',
      }),
    );
  });
});
