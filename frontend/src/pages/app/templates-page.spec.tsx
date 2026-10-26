import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TemplatesPage } from './templates-page';
import { agencyApi, templateApi } from '@/lib/api-client';
import { useAuth } from '@/contexts/auth-context';

vi.mock('@/lib/api-client', () => ({
  templateApi: {
    list: vi.fn(),
    copy: vi.fn(),
  },
  agencyApi: {
    listClients: vi.fn(),
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
        <TemplatesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const agencyWorkspace = {
  workspace: { id: 'ws-1', type: 'agency', name: 'Agencia Criativa', max_client_accounts: 10, created_at: '' },
  accounts: [
    { id: 'acct-home', name: 'Agencia Criativa', status: 'active', is_home: true },
    { id: 'acct-client-1', name: 'Loja A', status: 'active', is_home: false },
    { id: 'acct-client-2', name: 'Loja B', status: 'active', is_home: false },
  ],
  current_account: { id: 'acct-client-1', role: 'agency_admin' },
};

const brandWorkspace = {
  workspace: { id: 'ws-2', type: 'brand', name: 'Marca Propria', max_client_accounts: 1, created_at: '' },
  accounts: [{ id: 'acct-brand', name: 'Marca Propria', status: 'active', is_home: true }],
  current_account: { id: 'acct-brand', role: 'brand_owner' },
};

const oneTemplate = {
  data: [
    {
      id: 'tmpl-1',
      account_id: 'acct-client-1',
      name: 'Lancamento padrao',
      created_at: '2026-10-01T10:00:00Z',
    },
  ],
  pagination: { next_cursor: null, has_more: false },
};

// US-41 (E9): cross-client template copy, per
// docs/architecture/e9-agency-multi-client-operations.md section 4.2/6.
describe('TemplatesPage - US-41 cross-client template copy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not show the copy action outside an agency workspace', async () => {
    vi.mocked(useAuth).mockReturnValue({ workspace: brandWorkspace } as any);
    vi.mocked(templateApi.list).mockResolvedValue(oneTemplate);

    renderPage();

    await screen.findByText('Lancamento padrao');
    expect(screen.queryByRole('button', { name: 'Copiar para outro cliente' })).not.toBeInTheDocument();
  });

  it('lists every other client as a copy target, excluding the current (source) account', async () => {
    vi.mocked(useAuth).mockReturnValue({ workspace: agencyWorkspace } as any);
    vi.mocked(templateApi.list).mockResolvedValue(oneTemplate);
    vi.mocked(agencyApi.listClients).mockResolvedValue({
      data: [
        { id: 'acct-client-1', name: 'Loja A', status: 'active', brand_profile_status: 'complete', created_at: '' },
        { id: 'acct-client-2', name: 'Loja B', status: 'active', brand_profile_status: 'complete', created_at: '' },
      ],
      pagination: { next_cursor: null, has_more: false },
      limits: { used: 2, max: 10 },
    });

    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Copiar para outro cliente' }));

    await screen.findByLabelText('Cliente de destino');
    expect(screen.queryByRole('option', { name: 'Loja A' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Loja B' })).toBeInTheDocument();
  });

  it('copies the template to the chosen target client and shows a success confirmation', async () => {
    vi.mocked(useAuth).mockReturnValue({ workspace: agencyWorkspace } as any);
    vi.mocked(templateApi.list).mockResolvedValue(oneTemplate);
    vi.mocked(agencyApi.listClients).mockResolvedValue({
      data: [
        { id: 'acct-client-1', name: 'Loja A', status: 'active', brand_profile_status: 'complete', created_at: '' },
        { id: 'acct-client-2', name: 'Loja B', status: 'active', brand_profile_status: 'complete', created_at: '' },
      ],
      pagination: { next_cursor: null, has_more: false },
      limits: { used: 2, max: 10 },
    });
    vi.mocked(templateApi.copy).mockResolvedValue({
      id: 'tmpl-2',
      account_id: 'acct-client-2',
      copied_from_template_id: 'tmpl-1',
      name: 'Lancamento padrao',
      created_at: '2026-10-21T10:00:00Z',
    });

    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Copiar para outro cliente' }));
    await userEvent.selectOptions(await screen.findByLabelText('Cliente de destino'), 'acct-client-2');
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar copia' }));

    expect(await screen.findByText('Modelo copiado com sucesso.')).toBeInTheDocument();
    expect(templateApi.copy).toHaveBeenCalledWith('tmpl-1', { target_account_id: 'acct-client-2' });
  });

  it('shows an explicit error when the target client is not accessible', async () => {
    vi.mocked(useAuth).mockReturnValue({ workspace: agencyWorkspace } as any);
    vi.mocked(templateApi.list).mockResolvedValue(oneTemplate);
    vi.mocked(agencyApi.listClients).mockResolvedValue({
      data: [
        { id: 'acct-client-1', name: 'Loja A', status: 'active', brand_profile_status: 'complete', created_at: '' },
        { id: 'acct-client-2', name: 'Loja B', status: 'active', brand_profile_status: 'complete', created_at: '' },
      ],
      pagination: { next_cursor: null, has_more: false },
      limits: { used: 2, max: 10 },
    });
    vi.mocked(templateApi.copy).mockRejectedValue({
      isAxiosError: true,
      response: { data: { error: { message: 'Voce nao tem acesso ao cliente de destino.' } } },
    });

    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Copiar para outro cliente' }));
    await userEvent.selectOptions(await screen.findByLabelText('Cliente de destino'), 'acct-client-2');
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar copia' }));

    expect(await screen.findByText('Voce nao tem acesso ao cliente de destino.')).toBeInTheDocument();
  });
});
