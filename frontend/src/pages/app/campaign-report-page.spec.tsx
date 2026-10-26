import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CampaignReportPage } from './campaign-report-page';
import { campaignApi } from '@/lib/api-client';

vi.mock('@/lib/api-client', () => ({
  campaignApi: {
    get: vi.fn(),
    requestReport: vi.fn(),
    getReport: vi.fn(),
  },
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/app/campaigns/camp-1/reports']}>
        <Routes>
          <Route path="/app/campaigns/:id/reports" element={<CampaignReportPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const readyReportWithDeliveries = {
  id: 'rpt-001',
  status: 'ready' as const,
  campaign_progress_label: 'in_progress' as const,
  spend_amount: '45000.00',
  spend_source: 'locked_price' as const,
  has_deliveries: true,
  total_delivered_reach: 1230000,
  total_delivered_engagement: 45210,
  cost_per_engagement: '0.9953',
  cpm_equivalent: '36.59',
  pdf_document_url: 'https://assets.aurora.com.br/reports/rpt-001/report.pdf',
  csv_document_url: 'https://assets.aurora.com.br/reports/rpt-001/report.csv',
  resolved_at: '2026-10-21T10:00:05Z',
};

describe('CampaignReportPage - US-22', () => {
  beforeEach(() => vi.clearAllMocks());

  // ---- Scenario 1: a complete report with spend, delivered reach,
  // engagement, and cost efficiency, in both document formats. ----
  it('requests a report and shows spend, delivered reach/engagement, and cost efficiency figures', async () => {
    (campaignApi.get as any).mockResolvedValue({ id: 'camp-1', name: 'Lancamento Verao' });
    (campaignApi.requestReport as any).mockResolvedValue({ report_id: 'rpt-001', status: 'pending' });
    (campaignApi.getReport as any).mockResolvedValue(readyReportWithDeliveries);

    renderPage();

    await screen.findByText('Lancamento Verao');
    await userEvent.click(screen.getByRole('button', { name: 'Gerar relatorio' }));

    expect(await screen.findByText(/Investimento: R\$\s?45\.000,00/)).toBeInTheDocument();
    expect(screen.getByText(/Alcance entregue/)).toBeInTheDocument();
    expect(screen.getByText(/Engajamento entregue/)).toBeInTheDocument();
    expect(screen.getByText(/Custo por engajamento/)).toBeInTheDocument();
    expect(screen.getByText(/CPM equivalente/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Baixar PDF' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Baixar CSV' })).toBeInTheDocument();
  });

  // ---- Scenario 2: mid-campaign, no invoice yet -- spend comes from the
  // locked price, and the report states clearly the campaign is still in
  // progress rather than reading as a final result. ----
  it('states the campaign is still in progress and shows spend_source when the report is mid-campaign', async () => {
    (campaignApi.get as any).mockResolvedValue({ id: 'camp-1', name: 'Lancamento Verao' });
    (campaignApi.requestReport as any).mockResolvedValue({ report_id: 'rpt-001', status: 'pending' });
    (campaignApi.getReport as any).mockResolvedValue(readyReportWithDeliveries);

    renderPage();

    await screen.findByText('Lancamento Verao');
    await userEvent.click(screen.getByRole('button', { name: 'Gerar relatorio' }));

    expect(await screen.findByText('Campanha em andamento')).toBeInTheDocument();
    expect(screen.getByText(/Preco fechado na confirmacao da campanha/)).toBeInTheDocument();
  });

  it('shows a final badge when the campaign has completed', async () => {
    (campaignApi.get as any).mockResolvedValue({ id: 'camp-1', name: 'Lancamento Verao' });
    (campaignApi.requestReport as any).mockResolvedValue({ report_id: 'rpt-003', status: 'pending' });
    (campaignApi.getReport as any).mockResolvedValue({
      ...readyReportWithDeliveries,
      id: 'rpt-003',
      campaign_progress_label: 'final',
      spend_source: 'invoice',
    });

    renderPage();

    await screen.findByText('Lancamento Verao');
    await userEvent.click(screen.getByRole('button', { name: 'Gerar relatorio' }));

    expect(await screen.findByText('Campanha finalizada')).toBeInTheDocument();
    expect(screen.getByText(/Fatura consolidada/)).toBeInTheDocument();
  });

  // ---- Scenario 3: no creator has delivered yet -- spend is still shown
  // (already known at confirmation) but no fabricated zero figures; an
  // explicit message appears instead. ----
  it('shows spend and an explicit no-deliveries message, never zeroed figures, when nothing has been delivered yet', async () => {
    (campaignApi.get as any).mockResolvedValue({ id: 'camp-1', name: 'Lancamento Verao' });
    (campaignApi.requestReport as any).mockResolvedValue({ report_id: 'rpt-002', status: 'pending' });
    (campaignApi.getReport as any).mockResolvedValue({
      id: 'rpt-002',
      status: 'ready',
      campaign_progress_label: 'in_progress',
      spend_amount: '45000.00',
      spend_source: 'locked_price',
      has_deliveries: false,
      total_delivered_reach: null,
      total_delivered_engagement: null,
      cost_per_engagement: null,
      cpm_equivalent: null,
      message:
        'Nenhuma entrega confirmada ainda. O valor investido ja esta definido; os resultados aparecerao aqui conforme as publicacoes forem confirmadas.',
      pdf_document_url: 'https://assets.aurora.com.br/reports/rpt-002/report.pdf',
      csv_document_url: 'https://assets.aurora.com.br/reports/rpt-002/report.csv',
      resolved_at: '2026-10-21T10:00:02Z',
    });

    renderPage();

    await screen.findByText('Lancamento Verao');
    await userEvent.click(screen.getByRole('button', { name: 'Gerar relatorio' }));

    expect(await screen.findByText(/Investimento: R\$\s?45\.000,00/)).toBeInTheDocument();
    expect(
      screen.getByText(/Nenhuma entrega confirmada ainda\. O valor investido ja esta definido/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Alcance entregue/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Engajamento entregue/)).not.toBeInTheDocument();
  });

  it('shows a pending spinner while the report is being generated', async () => {
    (campaignApi.get as any).mockResolvedValue({ id: 'camp-1', name: 'Lancamento Verao' });
    (campaignApi.requestReport as any).mockResolvedValue({ report_id: 'rpt-001', status: 'pending' });
    (campaignApi.getReport as any).mockResolvedValue({ ...readyReportWithDeliveries, status: 'pending' });

    renderPage();

    await screen.findByText('Lancamento Verao');
    await userEvent.click(screen.getByRole('button', { name: 'Gerar relatorio' }));

    expect(await screen.findByText(/Gerando relatorio/)).toBeInTheDocument();
  });

  it('shows an explicit error when requesting the report fails', async () => {
    (campaignApi.get as any).mockResolvedValue({ id: 'camp-1', name: 'Lancamento Verao' });
    (campaignApi.requestReport as any).mockRejectedValue({
      isAxiosError: true,
      response: { data: { error: { message: 'Campanha nao encontrada.' } } },
    });

    renderPage();

    await screen.findByText('Lancamento Verao');
    await userEvent.click(screen.getByRole('button', { name: 'Gerar relatorio' }));

    expect(await screen.findByText('Campanha nao encontrada.')).toBeInTheDocument();
  });
});
