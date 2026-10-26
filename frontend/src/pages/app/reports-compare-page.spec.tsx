import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReportsComparePage } from './reports-compare-page';
import { agencyApi } from '@/lib/api-client';

vi.mock('@/lib/api-client', () => ({
  agencyApi: {
    listClients: vi.fn(),
    compareReports: vi.fn(),
  },
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ReportsComparePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const clientA = { id: 'acct-1', name: 'Loja A' };
const clientB = { id: 'acct-2', name: 'Loja B' };

describe('ReportsComparePage - US-46', () => {
  beforeEach(() => vi.clearAllMocks());

  // ---- Scenario 1: a side-by-side comparison across two or more clients,
  // the same per-pool aggregate figures as US-21b, within her own agency
  // workspace. ----
  it('selects two clients and shows their per-pool aggregates side by side', async () => {
    (agencyApi.listClients as any).mockResolvedValue({ data: [clientA, clientB] });
    (agencyApi.compareReports as any).mockResolvedValue({
      data: [
        {
          client_account_id: 'acct-1',
          client_name: 'Loja A',
          campaign_count: 5,
          total_spend: '180000.00',
          total_delivered_reach: 2400000,
          total_delivered_engagement: 98000,
          average_reach_per_campaign: 480000,
          average_engagement_per_campaign: 19600,
        },
        {
          client_account_id: 'acct-2',
          client_name: 'Loja B',
          campaign_count: 1,
          total_spend: '20000.00',
          total_delivered_reach: 150000,
          total_delivered_engagement: 6200,
          average_reach_per_campaign: 150000,
          average_engagement_per_campaign: 6200,
        },
      ],
      refused: [],
    });

    renderPage();

    await screen.findByText('Loja A');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Loja A' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Loja B' }));
    await userEvent.click(screen.getByRole('button', { name: 'Comparar' }));

    expect(await screen.findByText(/Investimento total: R\$\s?180\.000,00/)).toBeInTheDocument();
    expect(screen.getByText(/Investimento total: R\$\s?20\.000,00/)).toBeInTheDocument();
  });

  // ---- Scenario 2: clients differ in campaign volume and timeframe --
  // each client's own totals and per-campaign averages are both shown
  // honestly, never normalized into a false equivalence, and a client with
  // less data (one campaign) is never silently excluded. ----
  it('shows totals and per-campaign averages honestly for clients with very different campaign volumes', async () => {
    (agencyApi.listClients as any).mockResolvedValue({ data: [clientA, clientB] });
    (agencyApi.compareReports as any).mockResolvedValue({
      data: [
        {
          client_account_id: 'acct-1',
          client_name: 'Loja A',
          campaign_count: 5,
          total_spend: '180000.00',
          total_delivered_reach: 2400000,
          total_delivered_engagement: 98000,
          average_reach_per_campaign: 480000,
          average_engagement_per_campaign: 19600,
        },
        {
          client_account_id: 'acct-2',
          client_name: 'Loja B',
          campaign_count: 1,
          total_spend: '20000.00',
          total_delivered_reach: 150000,
          total_delivered_engagement: 6200,
          average_reach_per_campaign: 150000,
          average_engagement_per_campaign: 6200,
        },
      ],
      refused: [],
    });

    renderPage();

    await screen.findByText('Loja A');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Loja A' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Loja B' }));
    await userEvent.click(screen.getByRole('button', { name: 'Comparar' }));

    await screen.findByText(/5 campanha\(s\)/);
    expect(screen.getByText(/1 campanha\(s\)/)).toBeInTheDocument();
    // The one-campaign client's data is present, not excluded for having less history.
    expect(screen.getByText(/Media de alcance\/campanha: 150\.000/)).toBeInTheDocument();
    expect(screen.getByText(/Media de alcance\/campanha: 480\.000/)).toBeInTheDocument();
  });

  // ---- Scenario 3: a client outside the caller's access is listed
  // explicitly as refused, never silently dropped in a way indistinguishable
  // from "this client simply has no data." ----
  it('lists a refused client explicitly, distinct from a client that legitimately has no comparison row', async () => {
    (agencyApi.listClients as any).mockResolvedValue({ data: [clientA, { id: 'acct-9', name: 'Loja Fora' }] });
    (agencyApi.compareReports as any).mockResolvedValue({
      data: [
        {
          client_account_id: 'acct-1',
          client_name: 'Loja A',
          campaign_count: 2,
          total_spend: '40000.00',
          total_delivered_reach: 100000,
          total_delivered_engagement: 4000,
          average_reach_per_campaign: 50000,
          average_engagement_per_campaign: 2000,
        },
      ],
      refused: [{ client_account_id: 'acct-9', reason: 'NOT_ACCESSIBLE' }],
    });

    renderPage();

    await screen.findByText('Loja A');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Loja A' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Loja Fora' }));
    await userEvent.click(screen.getByRole('button', { name: 'Comparar' }));

    await screen.findByText(/Nao incluidos na comparacao/);
    expect(screen.getByText('acct-9')).toBeInTheDocument();
    expect(screen.getByText('Sem acesso')).toBeInTheDocument();
  });

  it('shows an explicit error when every selected client is refused (NO_VALID_CLIENTS)', async () => {
    (agencyApi.listClients as any).mockResolvedValue({ data: [clientA] });
    (agencyApi.compareReports as any).mockRejectedValue({
      isAxiosError: true,
      response: { data: { error: { message: 'Nenhum dos clientes informados e valido ou acessivel.' } } },
    });

    renderPage();

    await screen.findByText('Loja A');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Loja A' }));
    await userEvent.click(screen.getByRole('button', { name: 'Comparar' }));

    expect(await screen.findByText('Nenhum dos clientes informados e valido ou acessivel.')).toBeInTheDocument();
  });

  it('disables the compare action until at least one client is selected', async () => {
    (agencyApi.listClients as any).mockResolvedValue({ data: [clientA] });

    renderPage();

    await screen.findByText('Loja A');
    expect(screen.getByRole('button', { name: 'Comparar' })).toBeDisabled();
  });
});
