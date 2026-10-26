import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PaymentDetailPage } from './payment-detail-page';
import { creatorPortalApi } from '@/lib/api-client';

vi.mock('@/lib/api-client', () => ({
  creatorPortalApi: {
    getPayoutObligation: vi.fn(),
    getPayoutStatement: vi.fn(),
    getTaxDocument: vi.fn(),
  },
  getCreatorToken: vi.fn(() => 'fake-creator-token'),
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/creator-portal/payments/pay-001']}>
        <Routes>
          <Route path="/creator-portal/payments/:id" element={<PaymentDetailPage />} />
        </Routes>
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
  payout_execution_attempts: [],
};

describe('PaymentDetailPage - US-35a/US-35b/US-35c', () => {
  beforeEach(() => vi.clearAllMocks());

  // Normal: every execution attempt is listed, not only the latest, so "why has this failed
  // before" is answerable from Duda's own view (section 4.3 of the architecture doc).
  it('shows every execution attempt with trigger and outcome', async () => {
    (creatorPortalApi.getPayoutObligation as any).mockResolvedValue({
      ...owedObligation,
      payout_execution_attempts: [
        {
          id: 'att-1',
          trigger: 'scheduled' as const,
          outcome: 'failed' as const,
          failure_reason: 'Chave Pix invalida informada pela criadora',
          provider_reference: null,
          created_at: '2026-10-24T10:00:00Z',
        },
        {
          id: 'att-2',
          trigger: 'manual' as const,
          outcome: 'instructed' as const,
          failure_reason: null,
          provider_reference: 'manual-confirmation-2026-10-28',
          created_at: '2026-10-28T09:00:00Z',
        },
      ],
    });

    renderPage();

    expect(await screen.findByText('Falhou')).toBeInTheDocument();
    expect(screen.getByText('Instruido')).toBeInTheDocument();
    expect(screen.getByText('Automatico')).toBeInTheDocument();
    expect(screen.getByText('Manual (operacao Aurora)')).toBeInTheDocument();
  });

  // Hard: repeated failed attempts never hide the obligation -- it stays listed as owed with
  // the latest reason, every time (US-35c scenario 2).
  it('shows the last failure reason while the obligation remains owed', async () => {
    (creatorPortalApi.getPayoutObligation as any).mockResolvedValue({
      ...owedObligation,
      last_failure_reason: 'Chave Pix invalida informada pela criadora',
    });

    renderPage();

    expect(await screen.findByText(/Chave Pix invalida informada pela criadora/)).toBeInTheDocument();
    expect(screen.getByText('Devido')).toBeInTheDocument();
  });

  // Normal: once settled, the tax document status/download is shown alongside the obligation
  // (US-36b scenario 1).
  it('shows a generated tax document once the obligation has settled', async () => {
    (creatorPortalApi.getPayoutObligation as any).mockResolvedValue({
      ...owedObligation,
      status: 'settled' as const,
      settled_at: '2026-10-28T12:00:00Z',
    });
    (creatorPortalApi.getTaxDocument as any).mockResolvedValue({
      status: 'generated' as const,
      tax_period: '2026-10',
      document_url: 'https://assets.aurora.com.br/tax-documents/pay-001/doc.pdf',
      generated_at: '2026-11-01T06:00:00Z',
    });

    renderPage();

    expect(await screen.findByText('Periodo: 2026-10')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Baixar documento fiscal' })).toBeInTheDocument();
  });

  // Failure: missing required profile data clearly flags what is missing, rather than silently
  // omitting the document (US-36b scenario 3).
  it('shows which information is missing when tax documentation is blocked', async () => {
    (creatorPortalApi.getPayoutObligation as any).mockResolvedValue({
      ...owedObligation,
      status: 'settled' as const,
      settled_at: '2026-10-28T12:00:00Z',
    });
    (creatorPortalApi.getTaxDocument as any).mockResolvedValue({
      status: 'blocked_missing_info' as const,
      missing_fields: ['tax_id'],
      message: 'Para gerar seu documento fiscal, e necessario informar seu CPF ou CNPJ no seu perfil.',
    });

    renderPage();

    expect(
      await screen.findByText('Para gerar seu documento fiscal, e necessario informar seu CPF ou CNPJ no seu perfil.'),
    ).toBeInTheDocument();
  });
});
