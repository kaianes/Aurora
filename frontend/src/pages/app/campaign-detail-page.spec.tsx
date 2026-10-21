import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CampaignDetailPage } from './campaign-detail-page';
import { campaignApi } from '@/lib/api-client';
import { useAuth } from '@/contexts/auth-context';

vi.mock('@/lib/api-client', () => ({
  campaignApi: {
    get: vi.fn(),
    getQuote: vi.fn(),
    getShortfall: vi.fn(),
    listReallocationEvents: vi.fn(),
    requestQuote: vi.fn(),
    confirm: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    cancel: vi.fn(),
    setReallocationBounds: vi.fn(),
    saveAsTemplate: vi.fn(),
  },
}));

vi.mock('@/contexts/auth-context', () => ({
  useAuth: vi.fn(),
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/app/campaigns/camp-1']}>
        <Routes>
          <Route path="/app/campaigns/:id" element={<CampaignDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const draftCampaign = {
  id: 'camp-1',
  account_id: 'acct-client-1',
  account_name: 'Cliente: Acme Cosmeticos',
  name: 'Lancamento Serum',
  state: 'draft' as const,
  budget_amount: null,
  budget_currency: 'BRL',
  audience_targeting: null,
  message: null,
  deliverable_formats: null,
  timeline_start: null,
  timeline_end: null,
  missing_fields: ['budget_amount'],
  created_at: '2026-10-15T14:00:00Z',
  updated_at: '2026-10-15T14:00:00Z',
};

// US-39 (E9): client attribution on the campaign detail header, per
// docs/architecture/e9-agency-multi-client-operations.md section 5.2/6.
describe('CampaignDetailPage - US-39 client attribution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({ currentRole: 'agency_admin' } as any);
  });

  it('shows the owning client account as a badge in the campaign header', async () => {
    vi.mocked(campaignApi.get).mockResolvedValue(draftCampaign);

    renderPage();

    expect(await screen.findByText('Lancamento Serum')).toBeInTheDocument();
    expect(screen.getByText('Cliente: Acme Cosmeticos')).toBeInTheDocument();
  });

  it('renders no attribution badge when account_name is absent', async () => {
    vi.mocked(campaignApi.get).mockResolvedValue({ ...draftCampaign, account_name: undefined });

    renderPage();

    expect(await screen.findByText('Lancamento Serum')).toBeInTheDocument();
    expect(screen.queryByText(/Cliente:/)).not.toBeInTheDocument();
  });
});

// US-39 scenario 2 (hard case): switching the active client context must not leave a
// previously-viewed campaign's stale detail on screen. The campaign detail query is keyed only
// on the route's campaign id (['campaign', id]), never on the current account, so switching
// context via the global account selector (no navigation, no remount, same route) does not
// cause this page to re-validate the campaign against the new account at all.
describe('CampaignDetailPage - US-39 scenario 2, switching client context without navigating away', () => {
  it('re-fetches the campaign against the backend after the account context switches, rather than continuing to show the previous client\'s cached detail', async () => {
    vi.mocked(useAuth).mockReturnValue({
      currentRole: 'agency_admin',
      workspace: { current_account: { id: 'acct-client-a' } },
    } as any);
    vi.mocked(campaignApi.get).mockResolvedValueOnce(draftCampaign);

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/app/campaigns/camp-1']}>
          <Routes>
            <Route path="/app/campaigns/:id" element={<CampaignDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
    const { rerender } = render(tree);

    expect(await screen.findByText('Lancamento Serum')).toBeInTheDocument();

    // US-39's selector switches context to Client B; the route/campaign id is unchanged, so a
    // correct implementation must still re-validate against the backend under the new
    // X-Account-Id (which would, in the real backend, 404 since camp-1 belongs to Client A) --
    // it must not simply keep rendering the cached response from Client A's context.
    vi.mocked(useAuth).mockReturnValue({
      currentRole: 'agency_admin',
      workspace: { current_account: { id: 'acct-client-b' } },
    } as any);

    rerender(tree);

    await vi.waitFor(() => {
      expect(campaignApi.get).toHaveBeenCalledTimes(2);
    });
  });
});
