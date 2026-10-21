import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ClientReportPage } from './client-report-page';
import { agencyApi } from '@/lib/api-client';

vi.mock('@/lib/api-client', () => ({
  agencyApi: {
    listClients: vi.fn(),
    requestClientReport: vi.fn(),
    getClientReport: vi.fn(),
  },
  setCurrentAccountId: vi.fn(),
}));

vi.mock('@/contexts/auth-context', () => ({
  useAuth: () => ({ workspace: { current_account: { id: 'acct-agency-home' } } }),
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/app/clients/acct-client-1/report']}>
        <Routes>
          <Route path="/app/clients/:id/report" element={<ClientReportPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const readyReportUnbranded = {
  id: 'rpt-001',
  status: 'ready' as const,
  campaign_count: 3,
  total_spend: '180000.00',
  total_delivered_reach: 2400000,
  total_delivered_engagement: 98000,
  cost_per_engagement: '1.8367',
  cpm_equivalent: '75.00',
  branding_applied: false,
  pdf_document_url: 'https://assets.aurora.com.br/client-reports/rpt-001/report.pdf',
  csv_document_url: 'https://assets.aurora.com.br/client-reports/rpt-001/report.csv',
  requested_at: '2026-10-21T10:00:00Z',
  resolved_at: '2026-10-21T10:00:05Z',
};

describe('ClientReportPage - US-43', () => {
  beforeEach(() => vi.clearAllMocks());

  // ---- Scenario 1 (unbranded state): a report generated before the
  // agency has configured branding shows branding_applied: false, with the
  // same content a direct-brand report would contain (spend, reach,
  // engagement, cost efficiency per US-22). ----
  it('requests a report and shows branding_applied false with a link to configure branding, before any branding exists', async () => {
    (agencyApi.listClients as any).mockResolvedValue({ data: [{ id: 'acct-client-1', name: 'Loja A' }] });
    (agencyApi.requestClientReport as any).mockResolvedValue({ report_id: 'rpt-001', status: 'pending' });
    (agencyApi.getClientReport as any).mockResolvedValue(readyReportUnbranded);

    renderPage();

    await screen.findByText('Loja A');
    await userEvent.click(screen.getByRole('button', { name: 'Gerar relatorio' }));

    expect(await screen.findByText('Sem marca configurada')).toBeInTheDocument();
    expect(screen.getByText(/Investimento total/)).toBeInTheDocument();
    expect(screen.getByText(/Alcance entregue/)).toBeInTheDocument();
    expect(screen.getByText(/Engajamento entregue/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Configurar marca da agencia/ })).toBeInTheDocument();
  });

  // ---- Scenario 1 (branded state): a report generated after the agency
  // has configured branding (ADR-0048) shows branding_applied: true, with
  // no call to action to configure branding. ----
  it('shows branding_applied true once the agency has configured branding, with no configure-branding prompt', async () => {
    (agencyApi.listClients as any).mockResolvedValue({ data: [{ id: 'acct-client-1', name: 'Loja A' }] });
    (agencyApi.requestClientReport as any).mockResolvedValue({ report_id: 'rpt-002', status: 'pending' });
    (agencyApi.getClientReport as any).mockResolvedValue({ ...readyReportUnbranded, id: 'rpt-002', branding_applied: true });

    renderPage();

    await screen.findByText('Loja A');
    await userEvent.click(screen.getByRole('button', { name: 'Gerar relatorio' }));

    expect(await screen.findByText('Com marca da agencia')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Configurar marca da agencia/ })).not.toBeInTheDocument();
  });

  // The request must act on the client account itself (section 2.5), not
  // the agency's home account -- the page switches X-Account-Id context for
  // the duration of the request and restores it afterward.
  it('temporarily switches account context to the client account for the report request, restoring it afterward', async () => {
    const { setCurrentAccountId } = await import('@/lib/api-client');
    (agencyApi.listClients as any).mockResolvedValue({ data: [{ id: 'acct-client-1', name: 'Loja A' }] });
    (agencyApi.requestClientReport as any).mockResolvedValue({ report_id: 'rpt-001', status: 'pending' });
    (agencyApi.getClientReport as any).mockResolvedValue(readyReportUnbranded);

    renderPage();

    await screen.findByText('Loja A');
    await userEvent.click(screen.getByRole('button', { name: 'Gerar relatorio' }));

    await screen.findByText('Sem marca configurada');
    expect(setCurrentAccountId).toHaveBeenCalledWith('acct-client-1');
    expect(setCurrentAccountId).toHaveBeenCalledWith('acct-agency-home');
  });

  it('shows a pending spinner while the report is being generated', async () => {
    (agencyApi.listClients as any).mockResolvedValue({ data: [{ id: 'acct-client-1', name: 'Loja A' }] });
    (agencyApi.requestClientReport as any).mockResolvedValue({ report_id: 'rpt-001', status: 'pending' });
    (agencyApi.getClientReport as any).mockResolvedValue({ ...readyReportUnbranded, status: 'pending' });

    renderPage();

    await screen.findByText('Loja A');
    await userEvent.click(screen.getByRole('button', { name: 'Gerar relatorio' }));

    expect(await screen.findByText(/Gerando relatorio/)).toBeInTheDocument();
  });

  it('shows an explicit error when requesting the report fails', async () => {
    (agencyApi.listClients as any).mockResolvedValue({ data: [{ id: 'acct-client-1', name: 'Loja A' }] });
    (agencyApi.requestClientReport as any).mockRejectedValue({
      isAxiosError: true,
      response: { data: { error: { message: 'Conta de cliente nao encontrada.' } } },
    });

    renderPage();

    await screen.findByText('Loja A');
    await userEvent.click(screen.getByRole('button', { name: 'Gerar relatorio' }));

    expect(await screen.findByText('Conta de cliente nao encontrada.')).toBeInTheDocument();
  });
});
