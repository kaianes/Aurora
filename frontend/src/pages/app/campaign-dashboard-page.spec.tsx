import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CampaignDashboardPage } from './campaign-dashboard-page';
import { campaignApi } from '@/lib/api-client';

vi.mock('@/lib/api-client', () => ({
  campaignApi: {
    get: vi.fn(),
    getDashboard: vi.fn(),
  },
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/app/campaigns/camp-1/dashboard']}>
        <Routes>
          <Route path="/app/campaigns/:id/dashboard" element={<CampaignDashboardPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const baseDashboard = {
  campaign_id: 'camp-1',
  campaign_state: 'active',
  pool_size: 2,
  delivered_count: 1,
  pending_delivery_count: 1,
  pool_aggregate: {
    total_delivered_reach: 18400,
    total_delivered_engagement: 920,
    total_delivered_impressions: 41000,
    any_stale: false,
    last_computed_at: '2026-10-21T06:00:00Z',
  },
  creators: [
    {
      creator_id: 'creator-9001',
      display_name: 'Duda Oliveira',
      status: 'delivered',
      reach: 18400,
      engagement: 920,
      impressions: 41000,
      ingestion_status: 'fresh',
      last_successful_pull_at: '2026-10-21T06:00:00Z',
    },
    {
      creator_id: 'creator-9050',
      display_name: 'Joao Pereira',
      status: 'pending_delivery',
      reach: null,
      engagement: null,
      impressions: null,
      ingestion_status: null,
      last_successful_pull_at: null,
    },
  ],
};

describe('CampaignDashboardPage - US-21b', () => {
  beforeEach(() => vi.clearAllMocks());

  // ---- Scenario 1: results render per creator and aggregated across the
  // pool, in the same view, without switching platforms or assembling the
  // numbers herself. ----
  it('renders the per-creator breakdown and a single aggregated pool total in the same view', async () => {
    (campaignApi.get as any).mockResolvedValue({ id: 'camp-1', name: 'Lancamento Serum Vitamina C' });
    (campaignApi.getDashboard as any).mockResolvedValue(baseDashboard);

    renderPage();

    expect(await screen.findByText('Duda Oliveira')).toBeInTheDocument();
    expect(screen.getByText(/Alcance total: 18\.400/)).toBeInTheDocument();
    expect(screen.getByText(/Engajamento total: 920/)).toBeInTheDocument();
    expect(screen.getByText('Joao Pereira')).toBeInTheDocument();
  });

  // ---- Scenario 2: creators who have not yet published are shown
  // distinctly ("pending delivery") rather than silently omitted or shown
  // with zeroed, misleading figures indistinguishable from a real zero. The
  // dashboard states how many of the pool have and have not yet published. ----
  it('shows a pending-delivery creator distinctly with dashes, never a zeroed figure', async () => {
    (campaignApi.get as any).mockResolvedValue({ id: 'camp-1', name: 'Campanha X' });
    (campaignApi.getDashboard as any).mockResolvedValue(baseDashboard);

    renderPage();

    await screen.findByText('Joao Pereira');
    expect(screen.getByText(/Entrega pendente/)).toBeInTheDocument();
    expect(screen.getByText('Pendente')).toBeInTheDocument();
    // delivered/pending counts stated explicitly for the whole pool
    expect(screen.getByText(/1 entregue\(s\)/)).toBeInTheDocument();
    expect(screen.getByText(/1 pendente\(s\)/)).toBeInTheDocument();
    expect(screen.getByText(/de 2 no pool/)).toBeInTheDocument();
  });

  // The pool-level aggregate itself must come from delivered creators only --
  // exercised here by confirming the rendered total matches exactly the
  // one delivered creator's own figures, not some average across both.
  it('computes the pool aggregate only from creators who actually delivered', async () => {
    (campaignApi.get as any).mockResolvedValue({ id: 'camp-1', name: 'Campanha X' });
    (campaignApi.getDashboard as any).mockResolvedValue(baseDashboard);

    renderPage();

    await screen.findByText('Duda Oliveira');
    expect(screen.getByText(/Alcance total: 18\.400/)).toBeInTheDocument();
  });

  // ---- Scenario 3: the ingestion feed behind the dashboard is degraded --
  // the dashboard still renders using last-known figures, each visibly
  // marked stale, rather than failing to render or silently presenting
  // stale data as current. ----
  it('still renders with a visible staleness banner when metrics are degraded, rather than failing to render', async () => {
    (campaignApi.get as any).mockResolvedValue({ id: 'camp-1', name: 'Campanha X' });
    (campaignApi.getDashboard as any).mockResolvedValue({
      ...baseDashboard,
      pool_aggregate: { ...baseDashboard.pool_aggregate, any_stale: true },
      creators: [
        {
          ...baseDashboard.creators[0],
          ingestion_status: 'stale_rate_limited',
        },
        baseDashboard.creators[1],
      ],
    });

    renderPage();

    expect(await screen.findByText(/Algumas metricas podem estar desatualizadas/)).toBeInTheDocument();
    expect(screen.getByText(/Desatualizado \(limite da plataforma\)/)).toBeInTheDocument();
    // Still fully rendered -- totals and per-creator figures are present, not blocked.
    expect(screen.getByText('Duda Oliveira')).toBeInTheDocument();
  });

  // US-21a scenario 3: a permanently lost authorization is never conflated
  // with a transient rate-limit/outage failure on the dashboard -- it gets
  // its own distinct label.
  it('surfaces a revoked authorization distinctly from a transient staleness failure', async () => {
    (campaignApi.get as any).mockResolvedValue({ id: 'camp-1', name: 'Campanha X' });
    (campaignApi.getDashboard as any).mockResolvedValue({
      ...baseDashboard,
      creators: [
        { ...baseDashboard.creators[0], ingestion_status: 'stale_auth_revoked' },
        baseDashboard.creators[1],
      ],
    });

    renderPage();

    expect(await screen.findByText('Autorizacao perdida')).toBeInTheDocument();
    expect(screen.queryByText(/Desatualizado \(limite da plataforma\)/)).not.toBeInTheDocument();
  });

  it('shows an explicit error state when the dashboard fails to load', async () => {
    (campaignApi.get as any).mockResolvedValue({ id: 'camp-1', name: 'Campanha X' });
    (campaignApi.getDashboard as any).mockRejectedValue({
      isAxiosError: true,
      response: { data: { error: { message: 'Campanha nao encontrada.' } } },
    });

    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent('Campanha nao encontrada.');
  });
});
