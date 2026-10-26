import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { MediaKitService } from './media-kit.service';
import { MediaKitExportStatus } from '../database/entities';

const mockRepo = () => ({
  findOne: vi.fn(),
  create: vi.fn((data: any) => ({ id: 'mk-1', ...data })),
  save: vi.fn((entity: any) => Promise.resolve(entity)),
});

describe('MediaKitService - US-25 / ADR-0057', () => {
  let service: MediaKitService;
  let repo: ReturnType<typeof mockRepo>;
  let queue: { add: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    repo = mockRepo();
    queue = { add: vi.fn().mockResolvedValue(undefined) };
    service = new MediaKitService(repo as any, queue as any);
  });

  it('creates a pending export and enqueues generate-media-kit', async () => {
    const result = await service.requestExport('creator-1');

    expect(result.status).toBe('pending');
    expect(queue.add).toHaveBeenCalledWith('generate-media-kit', { exportId: 'mk-1' });
    expect(result.poll_url).toContain('mk-1');
  });

  // Scenario 1: ready, with campaign history.
  it('returns the pdf url when ready with campaign history', async () => {
    repo.findOne.mockResolvedValue({
      id: 'mk-1',
      status: MediaKitExportStatus.READY,
      hasCampaignHistory: true,
      pdfDocumentUrl: 'https://assets.aurora.com.br/media-kits/mk-1/kit.pdf',
    });

    const result = await service.getExport('creator-1', 'mk-1');

    expect(result.has_campaign_history).toBe(true);
    expect(result.campaign_section_message).toBeUndefined();
  });

  // Scenario 2: ready, no campaign history yet.
  it('includes an explicit campaign_section_message when ready with no campaign history', async () => {
    repo.findOne.mockResolvedValue({
      id: 'mk-2',
      status: MediaKitExportStatus.READY,
      hasCampaignHistory: false,
      pdfDocumentUrl: 'https://assets.aurora.com.br/media-kits/mk-2/kit.pdf',
    });

    const result = await service.getExport('creator-1', 'mk-2');

    expect(result.has_campaign_history).toBe(false);
    expect(result.campaign_section_message).toContain('primeira entrega');
  });

  // Scenario 3: failure.
  it('offers a retry message, never a partial document, on failure', async () => {
    repo.findOne.mockResolvedValue({
      id: 'mk-3',
      status: MediaKitExportStatus.FAILED,
      failureReason: 'render_error',
    });

    const result = await service.getExport('creator-1', 'mk-3');

    expect(result.failure_reason).toBe('render_error');
    expect(result.message).toContain('Tente novamente');
    expect(result.pdf_document_url).toBeUndefined();
  });

  it('404s for an export that does not belong to this creator', async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(service.getExport('creator-1', 'mk-x')).rejects.toThrow(NotFoundException);
  });
});
