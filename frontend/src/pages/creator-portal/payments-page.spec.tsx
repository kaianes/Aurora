import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PaymentsPage } from './payments-page';
import { creatorPortalApi } from '@/lib/api-client';

vi.mock('@/lib/api-client', () => ({
  creatorPortalApi: {
    listPayoutObligations: vi.fn(),
    getPayoutStatement: vi.fn(),
  },
  getCreatorToken: vi.fn(() => 'fake-creator-token'),
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
        <PaymentsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const owedObligation = {
  id: 'pay-001',
  campaign_id: 'camp-1234',
  campaign_name: 'Lancamento Serum Vitamina C',
  buyer_name: 'Acme Cosmeticos',
  payout_gross: '800.00',
  payout_commission: '120.00',
  payout_net: '680.00',
  status: 'owed' as const,
  committed_deadline_at: '2026-10-28T00:00:00Z',
  last_failure_reason: null,
  escalated_for_manual_review: false,
  settled_at: null,
  created_at: '2026-10-23T08:00:00Z',
};

describe('PaymentsPage - US-36a', () => {
  beforeEach(() => vi.clearAllMocks());

  // Normal: the full history shows every obligation with gross/commission/net and status, and
  // a statement download action (US-36a scenario 1).
  it('shows every obligation with its figures, status, and buyer attribution', async () => {
    (creatorPortalApi.listPayoutObligations as any).mockResolvedValue({ data: [owedObligation] });

    renderPage();

    expect(await screen.findByText('Lancamento Serum Vitamina C')).toBeInTheDocument();
    expect(screen.getByText('Acme Cosmeticos')).toBeInTheDocument();
    expect(screen.getByText(/800,00/)).toBeInTheDocument();
    expect(screen.getByText(/120,00/)).toBeInTheDocument();
    expect(screen.getByText(/680,00/)).toBeInTheDocument();
    expect(screen.getAllByText('Devido').length).toBeGreaterThan(0);
  });

  // Normal: downloading a statement opens the signed URL the API returns.
  it('downloads a statement when requested', async () => {
    (creatorPortalApi.listPayoutObligations as any).mockResolvedValue({ data: [owedObligation] });
    (creatorPortalApi.getPayoutStatement as any).mockResolvedValue({
      payout_obligation_id: 'pay-001',
      document_url: 'https://assets.aurora.com.br/statements/pay-001/statement.pdf',
      generated_at: '2026-10-23T09:00:00Z',
    });
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    renderPage();
    await screen.findByText('Lancamento Serum Vitamina C');

    await userEvent.click(screen.getByRole('button', { name: 'Baixar extrato' }));

    await waitFor(() => expect(creatorPortalApi.getPayoutStatement).toHaveBeenCalledWith('pay-001'));
    expect(openSpy).toHaveBeenCalledWith(
      'https://assets.aurora.com.br/statements/pay-001/statement.pdf',
      '_blank',
      'noopener,noreferrer',
    );
  });

  // Hard: a failed attempt leaves the obligation visibly owed, with the reason shown, never
  // hidden or silently dropped (US-35c scenario 1).
  it('shows a failure reason while the obligation remains owed', async () => {
    (creatorPortalApi.listPayoutObligations as any).mockResolvedValue({
      data: [{ ...owedObligation, last_failure_reason: 'Chave Pix invalida informada pela criadora' }],
    });

    renderPage();

    expect(await screen.findByText(/Chave Pix invalida informada pela criadora/)).toBeInTheDocument();
    expect(screen.getAllByText('Devido').length).toBeGreaterThan(0);
  });

  // Hard: an obligation nearing its deadline unsettled is visibly flagged, not silently late
  // or indistinguishable from a normal one in progress (NFR-11, US-35b scenario 3).
  it('shows an escalation flag for an obligation flagged for manual review', async () => {
    (creatorPortalApi.listPayoutObligations as any).mockResolvedValue({
      data: [{ ...owedObligation, escalated_for_manual_review: true }],
    });

    renderPage();

    expect(await screen.findByText('Em atencao')).toBeInTheDocument();
  });

  // Failure: no obligation at all returns a clearly empty state, never an error (US-36a scenario 3).
  it('shows an empty state when there is no payment history', async () => {
    (creatorPortalApi.listPayoutObligations as any).mockResolvedValue({ data: [] });

    renderPage();

    expect(await screen.findByText('Nenhum pagamento registrado ainda.')).toBeInTheDocument();
  });
});
