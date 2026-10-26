import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CampaignFormPage } from './campaign-form-page';
import { campaignApi } from '@/lib/api-client';
import { useAuth } from '@/contexts/auth-context';

vi.mock('@/lib/api-client', () => ({
  campaignApi: {
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('@/contexts/auth-context', () => ({
  useAuth: vi.fn(),
}));

function renderNewCampaignForm() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/app/campaigns/new']}>
        <Routes>
          <Route path="/app/campaigns/new" element={<CampaignFormPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderEditCampaignForm() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/app/campaigns/camp-1/edit']}>
        <Routes>
          <Route path="/app/campaigns/:id/edit" element={<CampaignFormPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const agencyWorkspace = {
  workspace: { id: 'ws-1', type: 'agency', name: 'Agencia Criativa', max_client_accounts: 10, created_at: '' },
  accounts: [
    { id: 'acct-home', name: 'Agencia Criativa', status: 'active', is_home: true },
    { id: 'acct-client-1', name: 'Loja A', status: 'active', is_home: false },
  ],
  current_account: { id: 'acct-client-1', role: 'agency_admin' },
};

const brandWorkspace = {
  workspace: { id: 'ws-2', type: 'brand', name: 'Marca Propria', max_client_accounts: 1, created_at: '' },
  accounts: [{ id: 'acct-brand', name: 'Marca Propria', status: 'active', is_home: true }],
  current_account: { id: 'acct-brand', role: 'brand_owner' },
};

// US-39 (E9): a non-interactive confirmation of which client the campaign is about to be
// created for, shown only on the creation form, only in an agency workspace, per
// docs/architecture/e9-agency-multi-client-operations.md section 6. No new field is
// submitted -- POST /campaigns already attributes it via X-Account-Id (E2, FR-24, unchanged).
describe('CampaignFormPage - US-39 client-context notice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows which client the campaign will be created for, in an agency workspace', async () => {
    vi.mocked(useAuth).mockReturnValue({ workspace: agencyWorkspace } as any);

    renderNewCampaignForm();

    expect(await screen.findByText('Esta campanha sera criada para: Loja A')).toBeInTheDocument();
  });

  it('shows no client-context notice in a brand workspace', async () => {
    vi.mocked(useAuth).mockReturnValue({ workspace: brandWorkspace } as any);

    renderNewCampaignForm();

    await screen.findByLabelText('Nome da campanha');
    expect(screen.queryByText(/Esta campanha sera criada para/)).not.toBeInTheDocument();
  });

  it('shows no client-context notice when editing an existing campaign', async () => {
    vi.mocked(useAuth).mockReturnValue({ workspace: agencyWorkspace } as any);
    vi.mocked(campaignApi.get).mockResolvedValue({
      id: 'camp-1',
      account_id: 'acct-client-1',
      name: 'Campanha existente',
      state: 'draft',
      budget_amount: null,
      budget_currency: 'BRL',
      audience_targeting: null,
      message: null,
      deliverable_formats: null,
      timeline_start: null,
      timeline_end: null,
      missing_fields: [],
      created_at: '2026-10-15T14:00:00Z',
      updated_at: '2026-10-15T14:00:00Z',
    });

    renderEditCampaignForm();

    await screen.findByDisplayValue('Campanha existente');
    expect(screen.queryByText(/Esta campanha sera criada para/)).not.toBeInTheDocument();
  });
});
