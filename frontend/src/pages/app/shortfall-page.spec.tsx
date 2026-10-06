import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ShortfallPage } from './shortfall-page';
import { campaignApi } from '@/lib/api-client';
import { useAuth } from '@/contexts/auth-context';

vi.mock('@/lib/api-client', () => ({
  campaignApi: {
    getShortfall: vi.fn(),
    resolveShortfall: vi.fn(),
  },
}));

vi.mock('@/contexts/auth-context', () => ({
  useAuth: vi.fn(),
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/app/campaigns/camp-1/shortfall']}>
        <Routes>
          <Route path="/app/campaigns/:id/shortfall" element={<ShortfallPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ShortfallPage - US-07 scenario 3 / ADR-0008', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue({ currentRole: 'brand_owner' } as any);
  });

  // ---- Normal: no shortfall exists, guarantee was met ----
  it('shows a success message when no shortfall was recorded', async () => {
    vi.mocked(campaignApi.getShortfall).mockResolvedValue({ shortfall: null });

    renderPage();

    await waitFor(() => expect(screen.getByText(/pool minimo garantido foi atendido/i)).toBeInTheDocument());
  });

  // ---- Hard: a small shortfall (<15%) offers only the Aurora default
  // resolution, confirmed with a single button, no choice between options ----
  it('shows a single confirm action for a small shortfall offered as aurora_default', async () => {
    vi.mocked(campaignApi.getShortfall).mockResolvedValue({
      shortfall: {
        id: 'sf-1',
        resolution_type: 'revised_guarantee',
        refund_amount: null,
        revised_min_pool_size: 19,
        chosen_by: 'aurora_default',
        notified_at: '2026-10-05T10:00:00Z',
        resolved_at: null,
      },
    });

    renderPage();

    await waitFor(() => expect(screen.getByText(/garantia revisada/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /confirmar/i })).toBeInTheDocument();
    expect(screen.queryByText(/reembolso parcial/i)).not.toBeInTheDocument();
  });

  // ---- Failure/bug case: a LARGE shortfall (>=15%) must let the buyer
  // choose between partial refund and revised guarantee (ADR-0008, US-07
  // scenario 3: "the buyer explicitly chooses between a proportional refund
  // and a revised guarantee"). The backend signals this via
  // choice_offered=true on the shortfall it creates (see campaign.service.ts
  // recordShortfall). The GET /campaigns/:id/shortfall response the page
  // consumes, however, never includes this flag (see
  // campaign.service.additional.spec.ts "BUG: getShortfall response omits
  // choice_offered"), so the page's own heuristic (`chosen_by === 'buyer'`)
  // can never be true before the buyer has actually resolved it -- the
  // choice UI never renders for a large shortfall. This test documents that
  // failure against the acceptance criterion. ----
  it('BUG: does not offer a refund-vs-revised-guarantee choice for a large shortfall before it is resolved', async () => {
    vi.mocked(campaignApi.getShortfall).mockResolvedValue({
      shortfall: {
        id: 'sf-2',
        resolution_type: 'revised_guarantee',
        refund_amount: '8500.00',
        revised_min_pool_size: 16,
        // This is what the backend actually sends for an unresolved shortfall,
        // even when it was created with choiceOffered=true internally.
        chosen_by: 'aurora_default',
        notified_at: '2026-10-28T09:00:00Z',
        resolved_at: null,
      },
    });

    renderPage();

    await waitFor(() => expect(screen.getByText(/garantia revisada/i)).toBeInTheDocument());

    // Per the acceptance criterion, Marina should be able to pick between
    // "Reembolso parcial" and "Garantia revisada" here. She cannot.
    expect(screen.queryByRole('button', { name: /reembolso parcial/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /garantia revisada/i })).not.toBeInTheDocument();
  });

  // ---- Normal: an already-resolved shortfall shows the confirmation, not
  // the choice/confirm controls ----
  it('shows the resolved confirmation and no action buttons once resolved_at is set', async () => {
    vi.mocked(campaignApi.getShortfall).mockResolvedValue({
      shortfall: {
        id: 'sf-3',
        resolution_type: 'partial_refund',
        refund_amount: '8500.00',
        revised_min_pool_size: null,
        chosen_by: 'buyer',
        notified_at: '2026-10-28T09:00:00Z',
        resolved_at: '2026-10-28T10:15:00Z',
      },
    });

    renderPage();

    await waitFor(() => expect(screen.getByText(/resolucao confirmada/i)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /confirmar/i })).not.toBeInTheDocument();
  });
});
