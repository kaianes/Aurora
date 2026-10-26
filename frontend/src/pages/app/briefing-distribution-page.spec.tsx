import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BriefingDistributionPage } from './briefing-distribution-page';
import { briefingApi } from '@/lib/api-client';

vi.mock('@/lib/api-client', () => ({
  briefingApi: {
    getDistribution: vi.fn(),
  },
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/app/campaigns/camp-1/briefing/distribution']}>
        <Routes>
          <Route path="/app/campaigns/:id/briefing/distribution" element={<BriefingDistributionPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('BriefingDistributionPage - US-18b', () => {
  beforeEach(() => vi.clearAllMocks());

  // Failure: the send cannot be reported as fully successful when one or more creators were not
  // reached -- each failed recipient is named with its own specific reason (US-18b scenario 3).
  it('reports exactly which creators the briefing failed to reach, never collapsing it into success', async () => {
    (briefingApi.getDistribution as any).mockResolvedValue({
      briefing_id: 'brf-001',
      recipients_total: 3,
      delivered: 1,
      failed: [
        { creator_id: 'creator-9009', failure_reason: 'no_contact_channel' },
        { creator_id: 'creator-9010', failure_reason: 'notification_provider_error' },
      ],
      pending: 0,
    });

    renderPage();

    expect(await screen.findByText('Total de destinatarios: 3')).toBeInTheDocument();
    expect(screen.getByText('Entregues: 1')).toBeInTheDocument();
    expect(screen.getByText('Com falha: 2')).toBeInTheDocument();
    expect(screen.getByText('creator-9009')).toBeInTheDocument();
    expect(screen.getByText('no_contact_channel')).toBeInTheDocument();
    expect(screen.getByText('creator-9010')).toBeInTheDocument();
    expect(screen.getByText('notification_provider_error')).toBeInTheDocument();
    // Never shown when there is a real failure.
    expect(screen.queryByText(/alcancou todos/)).not.toBeInTheDocument();
  });

  // Normal: when every recipient is reached, the success summary is shown and no failure list
  // renders (US-18b scenario 1).
  it('shows a success summary only when every recipient was actually reached', async () => {
    (briefingApi.getDistribution as any).mockResolvedValue({
      briefing_id: 'brf-001',
      recipients_total: 2,
      delivered: 2,
      failed: [],
      pending: 0,
    });

    renderPage();

    expect(await screen.findByText('O briefing alcancou todos os 2 criadores do pool.')).toBeInTheDocument();
    expect(screen.queryByText('Criadores que o briefing nao alcancou')).not.toBeInTheDocument();
  });

  // Hard: while the asynchronous fan-out is still resolving some recipients, the page reflects
  // that explicitly rather than reporting a premature final outcome (reaches the most recently
  // approved creators the same way as everyone else -- US-18b scenario 2's "at this moment").
  it('shows pending recipients as still in progress rather than a premature final outcome', async () => {
    (briefingApi.getDistribution as any).mockResolvedValue({
      briefing_id: 'brf-001',
      recipients_total: 5,
      delivered: 2,
      failed: [],
      pending: 3,
    });

    renderPage();

    expect(await screen.findByText(/3 ainda em processamento\./)).toBeInTheDocument();
    expect(screen.queryByText(/alcancou todos/)).not.toBeInTheDocument();
  });

  it('shows an error message when the distribution status cannot be loaded', async () => {
    (briefingApi.getDistribution as any).mockRejectedValue({
      isAxiosError: true,
      response: { data: { error: { message: 'Nenhum briefing foi salvo para esta campanha ainda.' } } },
    });

    renderPage();

    expect(await screen.findByText('Nenhum briefing foi salvo para esta campanha ainda.')).toBeInTheDocument();
  });
});
