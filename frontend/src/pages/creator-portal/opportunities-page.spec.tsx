import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OpportunitiesPage } from './opportunities-page';
import { creatorPortalApi, getCreatorToken } from '@/lib/api-client';

vi.mock('@/lib/api-client', () => ({
  creatorPortalApi: {
    listOpportunities: vi.fn(),
    accept: vi.fn(),
    decline: vi.fn(),
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
        <OpportunitiesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const pendingOpportunity = {
  id: 'opp-1',
  campaign_id: 'camp-1',
  brand_name: 'Acme Cosmeticos',
  deliverable: { format: 'instagram_reel', quantity: 1 },
  payout_gross: '800.00',
  payout_commission: '120.00',
  payout_net: '680.00',
  expires_at: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
  status: 'pending' as const,
};

describe('OpportunitiesPage - US-28', () => {
  beforeEach(() => vi.clearAllMocks());

  // Normal: Duda accepts an opportunity and sees the payout breakdown confirmed (US-28 scenario 1).
  it('accepts an opportunity and shows the gross/commission/net payout figures', async () => {
    (creatorPortalApi.listOpportunities as any).mockResolvedValue({ data: [pendingOpportunity] });
    (creatorPortalApi.accept as any).mockResolvedValue({ ...pendingOpportunity, status: 'accepted' });

    renderPage();

    expect(await screen.findByText('Acme Cosmeticos')).toBeInTheDocument();
    expect(screen.getByText(/800,00/)).toBeInTheDocument();
    expect(screen.getByText(/120,00/)).toBeInTheDocument();
    expect(screen.getByText(/680,00/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Aceitar' }));
    await waitFor(() => expect(creatorPortalApi.accept).toHaveBeenCalledWith('opp-1'));
  });

  // Hard: Duda declines an opportunity; the system records it without any penalty language rendered (US-28 scenario 2).
  it('declines an opportunity without surfacing any eligibility penalty', async () => {
    (creatorPortalApi.listOpportunities as any).mockResolvedValue({ data: [pendingOpportunity] });
    (creatorPortalApi.decline as any).mockResolvedValue({ ...pendingOpportunity, status: 'declined' });

    renderPage();
    await screen.findByText('Acme Cosmeticos');

    await userEvent.click(screen.getByRole('button', { name: 'Recusar' }));

    await waitFor(() => expect(creatorPortalApi.decline).toHaveBeenCalledWith('opp-1'));
    expect(screen.queryByText(/penaliza/i)).not.toBeInTheDocument();
  });

  // Failure: accepting an opportunity that already expired shows an explicit expiry message, not a silent failure (US-28 scenario 3).
  it('shows an explicit expiry message when accept is rejected as expired', async () => {
    (creatorPortalApi.listOpportunities as any).mockResolvedValue({ data: [pendingOpportunity] });
    (creatorPortalApi.accept as any).mockRejectedValue({
      isAxiosError: true,
      response: { data: { error: { code: 'OPPORTUNITY_EXPIRED', message: 'Esta oportunidade expirou.' } } },
    });

    renderPage();
    await screen.findByText('Acme Cosmeticos');

    await userEvent.click(screen.getByRole('button', { name: 'Aceitar' }));

    expect(await screen.findByText(/expirou antes do seu aceite/)).toBeInTheDocument();
  });
});
