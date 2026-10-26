import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StubSocialMetricsAdapter } from './social-metrics.adapter';

const mockRepo = () => ({ findOne: vi.fn() });

// ADR-0044: this pilot's only implementation always succeeds, deterministically.
describe('StubSocialMetricsAdapter - ADR-0044', () => {
  let adapter: StubSocialMetricsAdapter;
  let submissionRepo: ReturnType<typeof mockRepo>;

  beforeEach(() => {
    submissionRepo = mockRepo();
    adapter = new StubSocialMetricsAdapter(submissionRepo as any);
  });

  it('always returns outcome success', async () => {
    submissionRepo.findOne.mockResolvedValue({ publishedAt: new Date() });

    const result = await adapter.pullMetrics({
      creatorId: 'creator-1',
      contentSubmissionId: 'sub-1',
      platform: 'instagram',
      publishedUrl: 'https://instagram.com/p/abc',
    });

    expect(result.outcome).toBe('success');
  });

  it('is deterministic: the same submission id produces the same figures when elapsed time is held constant', async () => {
    const publishedAt = new Date('2026-10-01T00:00:00Z');
    submissionRepo.findOne.mockResolvedValue({ publishedAt });

    const input = {
      creatorId: 'creator-1',
      contentSubmissionId: 'sub-fixed-id',
      platform: 'instagram',
      publishedUrl: 'https://instagram.com/p/abc',
    };

    const first = await adapter.pullMetrics(input);
    const second = await adapter.pullMetrics(input);

    expect(first).toEqual(second);
  });

  it('produces different figures for different submission ids', async () => {
    submissionRepo.findOne.mockResolvedValue({ publishedAt: new Date('2026-10-01T00:00:00Z') });

    const first = await adapter.pullMetrics({
      creatorId: 'creator-1',
      contentSubmissionId: 'sub-a',
      platform: 'instagram',
      publishedUrl: 'https://instagram.com/p/a',
    });
    const second = await adapter.pullMetrics({
      creatorId: 'creator-1',
      contentSubmissionId: 'sub-b',
      platform: 'instagram',
      publishedUrl: 'https://instagram.com/p/b',
    });

    expect(first).not.toEqual(second);
  });
});
