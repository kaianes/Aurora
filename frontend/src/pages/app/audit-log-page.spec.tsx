import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuditLogPage } from './audit-log-page';
import { auditApi } from '@/lib/api-client';
import { useAuth } from '@/contexts/auth-context';

vi.mock('@/lib/api-client', () => ({
  auditApi: {
    list: vi.fn(),
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
        <AuditLogPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function withAccount(accountId: string) {
  return { workspace: { current_account: { id: accountId, role: 'agency_admin' } } } as any;
}

// FR-60 -- the audit log read endpoint's own first viewer, per
// docs/architecture/e9-agency-multi-client-operations.md section 5.4.
describe('AuditLogPage - FR-60', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a chronological list of audit entries for the selected client account', async () => {
    vi.mocked(useAuth).mockReturnValue(withAccount('acct-client-1'));
    vi.mocked(auditApi.list).mockResolvedValue({
      data: [
        {
          id: '8842',
          actor_user_id: 'user-1',
          actor_name: 'Renata Alves',
          actor_email: 'renata@agenciacriativa.com.br',
          action: 'operator_access.granted',
          metadata: { operator_user_id: 'op-1234' },
          created_at: '2026-10-20T09:00:00Z',
        },
        {
          id: '8810',
          actor_user_id: null,
          actor_name: null,
          actor_email: null,
          action: 'campaign_template.copied',
          metadata: { source_template_id: 'tmpl-0001' },
          created_at: '2026-10-19T15:30:00Z',
        },
      ],
      pagination: { next_cursor: '8810', has_more: true },
    });

    renderPage();

    expect(await screen.findByText('operator_access.granted')).toBeInTheDocument();
    expect(screen.getByText('Renata Alves (renata@agenciacriativa.com.br)')).toBeInTheDocument();
    expect(screen.getByText('campaign_template.copied')).toBeInTheDocument();
    expect(screen.getByText('Sistema')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Carregar mais' })).toBeInTheDocument();
  });

  it('loads the next page and appends it to the list on "Carregar mais"', async () => {
    vi.mocked(useAuth).mockReturnValue(withAccount('acct-client-1'));
    vi.mocked(auditApi.list).mockImplementation((params?: { cursor?: string }) => {
      if (!params?.cursor) {
        return Promise.resolve({
          data: [
            {
              id: '8842',
              actor_user_id: 'user-1',
              actor_name: 'Renata Alves',
              actor_email: 'renata@agenciacriativa.com.br',
              action: 'operator_access.granted',
              metadata: {},
              created_at: '2026-10-20T09:00:00Z',
            },
          ],
          pagination: { next_cursor: '8842', has_more: true },
        });
      }
      return Promise.resolve({
        data: [
          {
            id: '8810',
            actor_user_id: null,
            actor_name: null,
            actor_email: null,
            action: 'campaign_template.copied',
            metadata: {},
            created_at: '2026-10-19T15:30:00Z',
          },
        ],
        pagination: { next_cursor: null, has_more: false },
      });
    });

    renderPage();

    await screen.findByText('operator_access.granted');
    await userEvent.click(screen.getByRole('button', { name: 'Carregar mais' }));

    expect(await screen.findByText('campaign_template.copied')).toBeInTheDocument();
    expect(screen.getByText('operator_access.granted')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).not.toBeInTheDocument();
  });

  it('shows an empty state when the client account has no recorded events', async () => {
    vi.mocked(useAuth).mockReturnValue(withAccount('acct-client-1'));
    vi.mocked(auditApi.list).mockResolvedValue({ data: [], pagination: { next_cursor: null, has_more: false } });

    renderPage();

    expect(await screen.findByText('Nenhum evento registrado nesta conta ainda.')).toBeInTheDocument();
  });

  it('shows an explicit error when the request is refused (e.g. an operator without access to this client)', async () => {
    vi.mocked(useAuth).mockReturnValue(withAccount('acct-client-2'));
    vi.mocked(auditApi.list).mockRejectedValue({
      isAxiosError: true,
      response: { data: { error: { message: 'Voce nao tem acesso a esta conta.' } } },
    });

    renderPage();

    expect(await screen.findByText('Voce nao tem acesso a esta conta.')).toBeInTheDocument();
  });
});
