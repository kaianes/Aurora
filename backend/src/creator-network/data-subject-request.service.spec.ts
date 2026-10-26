import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { DataSubjectRequestService } from './data-subject-request.service';

const mockRepo = () => ({
  findOne: vi.fn(),
  create: vi.fn((data: any) => ({ id: 'dsr-1', ...data })),
  save: vi.fn((entity: any) => Promise.resolve(entity)),
});

describe('DataSubjectRequestService - ADR-0056 (NFR-21 ongoing rights)', () => {
  let service: DataSubjectRequestService;
  let creatorRepo: ReturnType<typeof mockRepo>;
  let requestRepo: ReturnType<typeof mockRepo>;
  let auditService: { log: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    creatorRepo = mockRepo();
    requestRepo = mockRepo();
    auditService = { log: vi.fn().mockResolvedValue(undefined) };
    service = new DataSubjectRequestService(creatorRepo as any, requestRepo as any, auditService as any);
  });

  it('creates a pending request with a due_at 15 days out', async () => {
    creatorRepo.findOne.mockResolvedValue({ id: 'creator-1' });

    const result = await service.create('creator-1', { request_type: 'deletion' }, 'operator-1', {
      ipAddress: '127.0.0.1',
      userAgent: 'test',
    });

    expect(result.status).toBe('pending');
    const dueAt = new Date(result.due_at);
    const expectedDueAt = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);
    expect(Math.abs(dueAt.getTime() - expectedDueAt.getTime())).toBeLessThan(5000);
  });

  it('404s for an unknown creator', async () => {
    creatorRepo.findOne.mockResolvedValue(null);
    await expect(
      service.create('ghost', { request_type: 'access' }, 'operator-1', { ipAddress: '', userAgent: '' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('fulfills a request, recording the export url for access/portability', async () => {
    requestRepo.findOne.mockResolvedValue({ id: 'dsr-1', creatorId: 'creator-1', requestType: 'access' });

    const result = await service.fulfill(
      'creator-1',
      'dsr-1',
      { status: 'fulfilled', export_document_url: 'https://assets.aurora.com.br/exports/dsr-1.pdf' },
      'operator-1',
      { ipAddress: '', userAgent: '' },
    );

    expect(result.status).toBe('fulfilled');
    expect(result.export_document_url).toContain('dsr-1.pdf');
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'creator_data_subject_request.fulfilled' }),
    );
  });

  it('404s when fulfilling a request that does not belong to this creator', async () => {
    requestRepo.findOne.mockResolvedValue(null);
    await expect(
      service.fulfill('creator-1', 'dsr-x', { status: 'fulfilled' }, 'operator-1', { ipAddress: '', userAgent: '' }),
    ).rejects.toThrow(NotFoundException);
  });
});
