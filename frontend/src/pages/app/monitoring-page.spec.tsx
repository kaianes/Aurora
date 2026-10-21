import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MonitoringPage } from './monitoring-page';
import { monitoringApi } from '@/lib/api-client';

vi.mock('@/lib/api-client', () => ({
  monitoringApi: {
    list: vi.fn(),
    get: vi.fn(),
  },
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/app/safety/monitoring']}>
        <MonitoringPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('MonitoringPage - US-16b', () => {
  beforeEach(() => vi.clearAllMocks());

  // Failure: an unreachable/removed post must be distinguishable from a deviated one, never
  // reported as still matching just because there is nothing left to compare (US-16b scenario 3).
  it('distinguishes an unreachable post from a deviated one', async () => {
    (monitoringApi.list as any).mockResolvedValue({
      data: [
        {
          id: 'snap-001',
          content_submission_id: 'sub-5001',
          campaign_id: 'camp-1234',
          published_url: 'https://instagram.com/p/abc123',
          last_result: 'deviated',
          last_checked_at: new Date().toISOString(),
          deviation_details: {
            field: 'caption_text',
            approved: 'Esse serum mudou minha pele em 14 dias!',
            current: 'Esse serum mudou minha pele em 14 dias! Link na bio com desconto de 70%',
          },
        },
        {
          id: 'snap-002',
          content_submission_id: 'sub-5002',
          campaign_id: 'camp-1234',
          published_url: 'https://instagram.com/p/def456',
          last_result: 'unreachable',
          last_checked_at: new Date().toISOString(),
          deviation_details: { reason: 'link_unreachable_or_removed' },
          consecutive_unreachable_count: 2,
        },
      ],
      pagination: { next_cursor: null, has_more: false },
    });

    renderPage();

    // Wait for the actual fetched snapshots (not the static filter dropdown, which also
    // contains the words "Divergente"/"Inacessivel" as filter options).
    await screen.findByText('https://instagram.com/p/abc123');
    expect(screen.getByText('https://instagram.com/p/def456')).toBeInTheDocument();

    expect(screen.getByText(/Campo "caption_text" mudou/)).toBeInTheDocument();
    expect(screen.getByText(/nao pode ser acessado ou o conteudo foi removido/)).toBeInTheDocument();
    expect(screen.getByText(/Verificacoes consecutivas sem acesso: 2/)).toBeInTheDocument();
  });
});
