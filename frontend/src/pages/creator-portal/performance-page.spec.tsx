import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CreatorPerformancePage } from './performance-page';
import { creatorPortalApi } from '@/lib/api-client';

vi.mock('@/lib/api-client', () => ({
  creatorPortalApi: {
    listPerformance: vi.fn(),
  },
  getCreatorToken: vi.fn(() => 'fake-token'),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <CreatorPerformancePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const freshEntry = {
  content_submission_id: 'sub-6001',
  campaign_id: 'camp-1234',
  campaign_name: 'Lancamento Serum Vitamina C',
  published_url: 'https://instagram.com/p/abc123',
  published_at: '2026-10-23T08:00:00Z',
  reach: 18400,
  engagement: 920,
  impressions: 41000,
  ingestion_status: 'fresh' as const,
  last_successful_pull_at: '2026-10-21T06:00:00Z',
};

describe('CreatorPerformancePage - US-37', () => {
  beforeEach(() => vi.clearAllMocks());

  // ---- Scenario 1: Duda sees her own delivered performance, and only her
  // own -- the page has no way to render anyone else's entry, since the
  // endpoint is scoped server-side and the page simply maps whatever `data`
  // comes back. ----
  it('renders reach and engagement for her own delivered content', async () => {
    (creatorPortalApi.listPerformance as any).mockResolvedValue({ data: [freshEntry] });

    renderPage();

    expect(await screen.findByText('Lancamento Serum Vitamina C')).toBeInTheDocument();
    expect(screen.getByText(/Alcance: 18\.400/)).toBeInTheDocument();
    expect(screen.getByText(/Engajamento: 920/)).toBeInTheDocument();
    expect(screen.getByText('Atualizado')).toBeInTheDocument();
  });

  // ---- Scenario 2: her metrics are temporarily stale -- she still sees
  // her last-known figures, clearly marked stale with the last successful
  // pull timestamp, rather than a blank state or an uninformative error. ----
  it('shows last-known figures clearly marked stale, not a blank state', async () => {
    (creatorPortalApi.listPerformance as any).mockResolvedValue({
      data: [{ ...freshEntry, ingestion_status: 'stale_unreachable' as const, reach: 500, engagement: 20 }],
    });

    renderPage();

    expect(await screen.findByText(/Alcance: 500/)).toBeInTheDocument();
    expect(screen.getByText('Desatualizado (plataforma indisponivel)')).toBeInTheDocument();
    expect(screen.getByText(/Metricas desatualizadas\. Ultima coleta bem-sucedida/)).toBeInTheDocument();
  });

  // ---- Scenario 3: a declined or still-pending opportunity has no
  // performance figures to show, and the page does not substitute another
  // of her campaigns' figures or a misleading zero. ----
  it('shows nothing for undelivered content, never a fabricated zero entry', async () => {
    (creatorPortalApi.listPerformance as any).mockResolvedValue({ data: [] });

    renderPage();

    expect(await screen.findByText('Nenhum conteudo publicado ainda.')).toBeInTheDocument();
    expect(screen.queryByText(/Alcance: 0/)).not.toBeInTheDocument();
  });

  // A mix of one delivered and nothing else for a different, undelivered
  // opportunity: only the delivered entry appears, confirming no
  // placeholder row is synthesized for anything beyond what the endpoint
  // returned.
  it('never shows more entries than the endpoint actually returned', async () => {
    (creatorPortalApi.listPerformance as any).mockResolvedValue({ data: [freshEntry] });

    renderPage();

    await screen.findByText('Lancamento Serum Vitamina C');
    expect(screen.getAllByText(/Ver publicacao/)).toHaveLength(1);
  });

  it('shows an explicit error state when performance fails to load', async () => {
    (creatorPortalApi.listPerformance as any).mockRejectedValue({
      isAxiosError: true,
      response: { data: { error: { message: 'Nao foi possivel carregar seu desempenho agora.' } } },
    });

    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent('Nao foi possivel carregar seu desempenho agora.');
  });
});
