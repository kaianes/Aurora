import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PublicClientReportPage } from './public-client-report-page';
import { publicApi } from '@/lib/api-client';

vi.mock('@/lib/api-client', () => ({
  publicApi: {
    getClientReport: vi.fn(),
  },
}));

function renderPage(token = 'pR3x-token') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/public/client-reports/${token}`]}>
        <Routes>
          <Route path="/public/client-reports/:token" element={<PublicClientReportPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const reportData = {
  campaign_count: 5,
  total_spend: '180000.00',
  total_delivered_reach: 2400000,
  total_delivered_engagement: 98000,
  cost_per_engagement: '1.8367',
  cpm_equivalent: '75.00',
  pdf_document_url: 'https://assets.aurora.com.br/reports/report.pdf',
  csv_document_url: 'https://assets.aurora.com.br/reports/report.csv',
};

// US-44 -- the one surface in this epic an agency's actual client company (no Aurora login at
// all) can open, per docs/architecture/e9-agency-multi-client-operations.md section 5.5.
describe('PublicClientReportPage - US-44', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the agency name and logo when branding is applied', async () => {
    (publicApi.getClientReport as any).mockResolvedValue({
      agency_name: 'Agencia Criativa',
      branding: {
        logo_url: 'https://assets.aurora.com.br/agency-branding/logo.png',
        primary_color_hex: '#1A2B3C',
        secondary_color_hex: '#FFFFFF',
        applied: true,
      },
      report: reportData,
    });

    renderPage();

    expect(await screen.findByText('Agencia Criativa')).toBeInTheDocument();
    expect(screen.getByAltText('Logo de Agencia Criativa')).toBeInTheDocument();
    expect(screen.getByText(/Campanhas: 5/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Baixar PDF' })).toHaveAttribute(
      'href',
      'https://assets.aurora.com.br/reports/report.pdf',
    );
  });

  // ---- Scenario 3 (ADR-0048, extended by US-44): never falls back to Aurora's own
  // branding when nothing is configured -- a neutral, agency-agnostic presentation instead. ----
  it('falls back to a neutral presentation, never Aurora-branded, when no branding is configured', async () => {
    (publicApi.getClientReport as any).mockResolvedValue({
      agency_name: 'Agencia Criativa',
      branding: { logo_url: null, primary_color_hex: null, secondary_color_hex: null, applied: false },
      report: reportData,
    });

    renderPage();

    expect(await screen.findByText('Relatorio de desempenho')).toBeInTheDocument();
    expect(screen.queryByText('Agencia Criativa')).not.toBeInTheDocument();
    expect(screen.queryByAltText(/Logo de/)).not.toBeInTheDocument();
  });

  it('shows a not-available message for a token that does not resolve (not found, revoked, or expired)', async () => {
    (publicApi.getClientReport as any).mockRejectedValue({
      isAxiosError: true,
      response: { status: 404, data: { error: { code: 'LINK_NOT_AVAILABLE' } } },
    });

    renderPage();

    expect(
      await screen.findByText('Este link nao esta mais disponivel. Ele pode ter expirado ou sido revogado.'),
    ).toBeInTheDocument();
  });
});
