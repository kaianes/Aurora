import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CampaignsPage } from './campaigns-page';
import { campaignApi } from '@/lib/api-client';
import { useAuth } from '@/contexts/auth-context';

vi.mock('@/lib/api-client', () => ({
  campaignApi: {
    list: vi.fn(),
  },
}));

vi.mock('@/contexts/auth-context', () => ({
  useAuth: vi.fn(),
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <CampaignsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// US-39 (E9): client attribution on the campaign list, per
// docs/architecture/e9-agency-multi-client-operations.md section 5.2/6. account_name is
// present on every campaign summary for every workspace type -- the page renders it
// unconditionally, never branching on workspace type itself.
describe('CampaignsPage - US-39 client attribution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({ currentRole: 'agency_admin' } as any);
  });

  it('shows the owning client account as a badge next to each campaign in an agency workspace', async () => {
    vi.mocked(campaignApi.list).mockResolvedValue({
      data: [
        {
          id: 'camp-1',
          name: 'Lancamento Serum',
          state: 'active',
          budget_amount: '45000.00',
          account_id: 'acct-client-1',
          account_name: 'Cliente: Acme Cosmeticos',
          created_at: '2026-10-15T14:00:00Z',
        },
      ],
      pagination: { next_cursor: null, has_more: false },
    });

    renderPage();

    expect(await screen.findByText('Lancamento Serum')).toBeInTheDocument();
    expect(screen.getByText('Cliente: Acme Cosmeticos')).toBeInTheDocument();
  });

  it('renders no attribution badge when account_name is absent (defensive: older/unrelated response shapes)', async () => {
    vi.mocked(campaignApi.list).mockResolvedValue({
      data: [
        {
          id: 'camp-1',
          name: 'Campanha sem atribuicao',
          state: 'draft',
          budget_amount: null,
          created_at: '2026-10-15T14:00:00Z',
        },
      ],
      pagination: { next_cursor: null, has_more: false },
    });

    renderPage();

    expect(await screen.findByText('Campanha sem atribuicao')).toBeInTheDocument();
    expect(screen.queryByText(/Cliente:/)).not.toBeInTheDocument();
  });

  it('shows an empty state and the create action when there are no campaigns', async () => {
    vi.mocked(campaignApi.list).mockResolvedValue({ data: [], pagination: { next_cursor: null, has_more: false } });

    renderPage();

    expect(await screen.findByText(/Nenhuma campanha ainda/)).toBeInTheDocument();
  });
});
