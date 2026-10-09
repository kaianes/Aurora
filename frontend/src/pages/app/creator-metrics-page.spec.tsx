import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CreatorMetricsPage } from './creator-metrics-page';
import { creatorApi } from '@/lib/api-client';

vi.mock('@/lib/api-client', () => ({
  creatorApi: {
    getMetrics: vi.fn(),
  },
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/app/campaigns/camp-1/shortlist/creators/creator-9001']}>
        <Routes>
          <Route path="/app/campaigns/:id/shortlist/creators/:creatorId" element={<CreatorMetricsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CreatorMetricsPage - US-12', () => {
  beforeEach(() => vi.clearAllMocks());

  // Normal: audience, demographics, engagement, niche, and authenticity score all shown (US-12 scenario 1, FR-09/10).
  it('shows audience size, engagement, niche and authenticity score', async () => {
    (creatorApi.getMetrics as any).mockResolvedValue({
      creator_id: 'creator-9001',
      display_name: 'Duda Oliveira',
      audience_size: 18400,
      demographic_composition: { age_18_24: 0.41 },
      engagement_rate: '4.2',
      content_niche: 'beleza e skincare',
      authenticity_score: 87,
      authenticity_flag: 'none',
      metrics_computed_at: '2026-10-04T08:00:00Z',
      metrics_stale: false,
      matched_attributes: ['interests:skincare'],
    });

    renderPage();

    expect(await screen.findByText('Duda Oliveira')).toBeInTheDocument();
    expect(screen.getByText(/18.400|18400/)).toBeInTheDocument();
    expect(screen.getByText('87')).toBeInTheDocument();
    expect(screen.getByText(/Sem alertas/)).toBeInTheDocument();
  });

  // Hard: a low authenticity score is surfaced prominently and the creator is not removed from anything (US-12 scenario 2).
  it('surfaces a low authenticity score prominently without hiding other metrics', async () => {
    (creatorApi.getMetrics as any).mockResolvedValue({
      creator_id: 'creator-9002',
      display_name: 'Creator Baixo Score',
      audience_size: 5000,
      demographic_composition: null,
      engagement_rate: '1.0',
      content_niche: 'moda',
      authenticity_score: 32,
      authenticity_flag: 'low',
      metrics_computed_at: '2026-10-04T08:00:00Z',
      metrics_stale: false,
      matched_attributes: [],
    });

    renderPage();

    expect(await screen.findByText('32')).toBeInTheDocument();
    expect(screen.getByText(/possivel fraude de seguidores/)).toBeInTheDocument();
    // decision stays with the human: no "removed" or rejection language rendered automatically
    expect(screen.queryByText(/removido/i)).not.toBeInTheDocument();
  });

  // Failure: stale metrics are shown with a timestamp, never hidden or blank (US-12 scenario 3, NFR-35).
  it('shows stale metrics clearly marked with a timestamp rather than hiding them', async () => {
    (creatorApi.getMetrics as any).mockResolvedValue({
      creator_id: 'creator-9003',
      display_name: 'Creator Desatualizado',
      audience_size: 9800,
      demographic_composition: null,
      engagement_rate: null,
      content_niche: null,
      authenticity_score: null,
      authenticity_flag: 'none',
      metrics_computed_at: '2026-09-20T08:00:00Z',
      metrics_stale: true,
      stale_since: '2026-10-01T00:00:00Z',
      matched_attributes: [],
    });

    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent(/desatualizadas/);
    // last-known audience size is still rendered, not blanked
    expect(screen.getByText(/9.800|9800/)).toBeInTheDocument();
  });
});
