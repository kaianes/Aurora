import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { InvoicePage } from './invoice-page';
import { campaignApi, invoiceApi } from '@/lib/api-client';
import { useAuth } from '@/contexts/auth-context';

vi.mock('@/lib/api-client', () => ({
  campaignApi: {
    get: vi.fn(),
  },
  invoiceApi: {
    get: vi.fn(),
    generate: vi.fn(),
  },
}));

vi.mock('@/contexts/auth-context', () => ({
  useAuth: vi.fn(),
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/app/campaigns/camp-1234/invoice']}>
        <Routes>
          <Route path="/app/campaigns/:id/invoice" element={<InvoicePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const campaign = {
  id: 'camp-1234',
  account_id: 'acc-1',
  name: 'Lancamento Serum Vitamina C',
  state: 'active' as const,
  budget_amount: '50000.00',
  budget_currency: 'BRL',
  audience_targeting: null,
  message: null,
  deliverable_formats: null,
  timeline_start: null,
  timeline_end: null,
  missing_fields: [],
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
};

describe('InvoicePage - US-20/US-42', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(campaignApi.get as any).mockResolvedValue(campaign);
    vi.mocked(useAuth).mockReturnValue({ currentRole: 'brand_owner' } as any);
  });

  // Normal: a single, already-generated invoice shows the fixed total price with any
  // itemized refund adjustment, never split into a separate document (US-20 scenario 1/2).
  it('shows the invoice total and itemized line items once generated', async () => {
    vi.mocked(invoiceApi.get as any).mockResolvedValue({
      id: 'inv-001',
      campaign_id: 'camp-1234',
      total_amount: '36500.00',
      line_items: [
        { line_type: 'base_price', description: 'Preco fixo da campanha (FR-18)', amount: '45000.00' },
        {
          line_type: 'shortfall_refund_adjustment',
          description: 'Reembolso proporcional por pool abaixo do minimo garantido (FR-19)',
          amount: '-8500.00',
        },
      ],
      issued_at: '2026-11-02T10:00:00Z',
    });

    renderPage();

    expect(await screen.findByText(/36\.500,00/)).toBeInTheDocument();
    expect(screen.getByText(/45\.000,00/)).toBeInTheDocument();
    expect(screen.getByText(/-?8\.500,00/)).toBeInTheDocument();
  });

  // Normal: a permitted role can trigger generation when no invoice exists yet.
  it('lets a permitted role generate the invoice when none exists yet', async () => {
    vi.mocked(invoiceApi.get as any).mockResolvedValue(null);
    vi.mocked(invoiceApi.generate as any).mockResolvedValue({
      id: 'inv-001',
      campaign_id: 'camp-1234',
      total_amount: '45000.00',
      line_items: [{ line_type: 'base_price', description: 'Preco fixo da campanha (FR-18)', amount: '45000.00' }],
      issued_at: '2026-11-02T10:00:00Z',
    });

    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Gerar fatura' }));

    await waitFor(() => expect(invoiceApi.generate).toHaveBeenCalledWith('camp-1234'));
  });

  // Failure: generation is refused while opportunities are still pending, stating why and
  // surfacing the pending count rather than producing a premature invoice (US-20 scenario 3).
  it('surfaces CAMPAIGN_NOT_BILLABLE with the pending opportunity count', async () => {
    vi.mocked(invoiceApi.get as any).mockResolvedValue(null);
    vi.mocked(invoiceApi.generate as any).mockRejectedValue({
      isAxiosError: true,
      response: {
        data: {
          error: {
            code: 'CAMPAIGN_NOT_BILLABLE',
            message: 'A campanha ainda tem oportunidades pendentes de resposta.',
            details: { pending_opportunities: 4 },
          },
        },
      },
    });

    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Gerar fatura' }));

    expect(await screen.findByText(/ainda tem oportunidades pendentes/)).toBeInTheDocument();
    expect(screen.getByText(/4 pendentes/)).toBeInTheDocument();
  });

  // Hard: a read-only role (brand_analyst) can view the invoice but is never offered the
  // generate action (section 3.5's "View campaign invoice: yes, Generate campaign invoice: no").
  it('does not offer the generate action to a read-only role', async () => {
    vi.mocked(useAuth).mockReturnValue({ currentRole: 'brand_analyst' } as any);
    vi.mocked(invoiceApi.get as any).mockResolvedValue(null);

    renderPage();

    await screen.findByText(/Nenhuma fatura foi gerada ainda/);
    expect(screen.queryByRole('button', { name: 'Gerar fatura' })).not.toBeInTheDocument();
  });
});
