import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { CreatorMetricsService } from './creator-metrics.service';

const mockRepo = () => ({
  findOne: vi.fn(),
});

describe('CreatorMetricsService - US-12', () => {
  let service: CreatorMetricsService;
  let creatorRepo: ReturnType<typeof mockRepo>;
  let entryRepo: ReturnType<typeof mockRepo>;

  beforeEach(() => {
    creatorRepo = mockRepo();
    entryRepo = mockRepo();
    service = new CreatorMetricsService(creatorRepo as any, entryRepo as any);
  });

  // ---- US-12 scenario 1: normal metrics visible with matched_attributes echoed for a campaign context ----
  it('returns audience/authenticity metrics and echoes matched_attributes for the given campaign', async () => {
    creatorRepo.findOne.mockResolvedValue({
      id: 'creator-9001',
      displayName: 'Duda Oliveira',
      audienceSize: 18400,
      demographicComposition: { age_18_24: 0.41 },
      engagementRate: '4.2',
      contentNiche: 'beleza e skincare',
      authenticityScore: '87',
      metricsComputedAt: new Date('2026-10-04T08:00:00Z'),
      metricsStale: false,
    });
    entryRepo.findOne.mockResolvedValue({ matchedAttributes: ['geography:BR-SP', 'interests:skincare'] });

    const result = await service.getMetrics('creator-9001', 'account-1', 'camp-1');

    expect(result.audience_size).toBe(18400);
    expect(result.authenticity_score).toBe(87);
    expect(result.authenticity_flag).toBe('none');
    expect(result.matched_attributes).toEqual(['geography:BR-SP', 'interests:skincare']);
    expect(result.metrics_stale).toBe(false);
  });

  // ---- US-12 scenario 2: a low authenticity score is flagged, never omitted, never auto-excluding ----
  it('flags a low authenticity score without omitting any other metric', async () => {
    creatorRepo.findOne.mockResolvedValue({
      id: 'creator-9002',
      displayName: 'Creator Baixo',
      audienceSize: 5000,
      demographicComposition: null,
      engagementRate: '1.0',
      contentNiche: 'moda',
      authenticityScore: '32',
      metricsComputedAt: new Date('2026-10-04T08:00:00Z'),
      metricsStale: false,
    });
    entryRepo.findOne.mockResolvedValue(null);

    const result = await service.getMetrics('creator-9002', 'account-1');

    expect(result.authenticity_score).toBe(32);
    expect(result.authenticity_flag).toBe('low');
    expect(result.audience_size).toBe(5000); // not hidden alongside the flag
  });

  // ---- US-12 scenario 3: stale metrics are returned with a timestamp, never blanked or hidden ----
  it('marks stale metrics with stale_since rather than blanking the last-known values', async () => {
    const computedAt = new Date('2026-09-20T08:00:00Z');
    creatorRepo.findOne.mockResolvedValue({
      id: 'creator-9003',
      displayName: 'Creator Stale',
      audienceSize: 9800,
      demographicComposition: null,
      engagementRate: null,
      contentNiche: null,
      authenticityScore: null,
      metricsComputedAt: computedAt,
      metricsStale: true,
    });
    entryRepo.findOne.mockResolvedValue(null);

    const result = await service.getMetrics('creator-9003', 'account-1');

    expect(result.metrics_stale).toBe(true);
    expect(result.stale_since).toBe(computedAt.toISOString());
    expect(result.audience_size).toBe(9800); // last-known value preserved, never blanked
  });

  // ---- Failure: an unknown creator id is a clean 404, not a silent empty response ----
  it('throws NotFoundException for an unknown creator id', async () => {
    creatorRepo.findOne.mockResolvedValue(null);

    await expect(service.getMetrics('creator-ghost', 'account-1')).rejects.toThrow(NotFoundException);
  });
});
