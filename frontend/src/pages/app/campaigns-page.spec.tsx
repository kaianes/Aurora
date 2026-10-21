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

// US-39 scenario 2 (hard case): "Renata ... switches her active client context to Client B
// ... every list ... view she opens under Client B's context shows only Client B's campaigns;
// nothing from Client A's context carries over by the switch itself." The account switcher
// (AppLayout) does not navigate or remount CampaignsPage -- it only updates the auth context's
// current_account and re-fetches the workspace. For the list to actually reflect the new
// client, the campaigns query must be scoped to (and refetch on) the current account, the same
// way AuditLogPage already keys its own query on accountId.
describe('CampaignsPage - US-39 scenario 2, switching client context without navigating away', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({
      currentRole: 'agency_admin',
      workspace: { current_account: { id: 'acct-client-a' } },
    } as any);
  });

  it('refetches and shows only the new client\'s campaigns after the account switcher changes context, with no stale campaign from the previous client left on screen', async () => {
    vi.mocked(campaignApi.list).mockResolvedValueOnce({
      data: [
        {
          id: 'camp-a1',
          name: 'Campanha Cliente A',
          state: 'active',
          budget_amount: '10000.00',
          account_id: 'acct-client-a',
          account_name: 'Cliente A',
          created_at: '2026-10-15T14:00:00Z',
        },
      ],
      pagination: { next_cursor: null, has_more: false },
    });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const renderTree = () => (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <CampaignsPage />
        </MemoryRouter>
      </QueryClientProvider>
    );
    const { rerender } = render(renderTree());

    expect(await screen.findByText('Campanha Cliente A')).toBeInTheDocument();

    // Simulate the US-39 account switcher: current_account changes from Client A to Client B,
    // with no route change and no remount of CampaignsPage (exactly how AppLayout's <select>
    // drives switchAccount today).
    vi.mocked(useAuth).mockReturnValue({
      currentRole: 'agency_admin',
      workspace: { current_account: { id: 'acct-client-b' } },
    } as any);
    vi.mocked(campaignApi.list).mockResolvedValueOnce({
      data: [
        {
          id: 'camp-b1',
          name: 'Campanha Cliente B',
          state: 'active',
          budget_amount: '20000.00',
          account_id: 'acct-client-b',
          account_name: 'Cliente B',
          created_at: '2026-10-16T14:00:00Z',
        },
      ],
      pagination: { next_cursor: null, has_more: false },
    });

    rerender(renderTree());

    expect(await screen.findByText('Campanha Cliente B')).toBeInTheDocument();
    expect(screen.queryByText('Campanha Cliente A')).not.toBeInTheDocument();
    expect(campaignApi.list).toHaveBeenCalledTimes(2);
  });
});
