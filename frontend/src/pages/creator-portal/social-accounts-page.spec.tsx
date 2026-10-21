import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SocialAccountsPage } from './social-accounts-page';

const navigateMock = vi.fn();

vi.mock('@/lib/api-client', () => ({
  creatorPortalApi: {
    listSocialAccounts: vi.fn(),
    authorizeSocialAccount: vi.fn(),
    disconnectSocialAccount: vi.fn(),
  },
  getCreatorToken: vi.fn(() => 'fake-creator-token'),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

import { creatorPortalApi } from '@/lib/api-client';

const originalLocation = window.location;

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SocialAccountsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SocialAccountsPage - US-24.1 scenario 2 (ongoing connection management)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // @ts-expect-error -- jsdom location is reassignable for the purpose of this test only.
    delete window.location;
    // @ts-expect-error -- see above.
    window.location = { ...originalLocation, href: '' };
  });

  // Hard (scenario 2, the proactive-detection half): a platform-side revocation flips the
  // connection to disconnected, and she is prompted to relink -- never shown a stale
  // "connected" badge -- while her other profile data (the other, still-connected platform)
  // is untouched.
  it('shows a disconnected badge and a relink prompt for a platform revoked on the platform side, without affecting her other connection', async () => {
    (creatorPortalApi.listSocialAccounts as any).mockResolvedValue({
      data: [
        {
          platform: 'instagram',
          platform_handle: '@duda',
          status: 'disconnected',
          disconnect_reason: 'revoked_by_platform',
          connected_at: '2026-09-01T00:00:00Z',
          disconnected_at: '2026-10-20T00:00:00Z',
        },
        {
          platform: 'tiktok',
          platform_handle: '@duda.tok',
          status: 'connected',
          disconnect_reason: null,
          connected_at: '2026-09-01T00:00:00Z',
          disconnected_at: null,
        },
      ],
    });

    renderPage();

    expect(await screen.findByText('Desconectado')).toBeInTheDocument();
    expect(screen.getByText(/Acesso revogado pela plataforma/i)).toBeInTheDocument();
    expect(screen.getByText(/reconecte para voltar a receber metricas atualizadas/i)).toBeInTheDocument();
    // TikTok, still connected, is shown as connected and untouched.
    expect(screen.getByText('Conectado')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reconectar' })).toBeInTheDocument();
  });

  // The manual-disconnect half: a manual disconnect shows a distinct, non-alarming reason,
  // not the platform-revocation warning copy.
  it('shows a plain manual-disconnect message, distinct from a platform-side revocation', async () => {
    (creatorPortalApi.listSocialAccounts as any).mockResolvedValue({
      data: [
        {
          platform: 'instagram',
          platform_handle: '@duda',
          status: 'disconnected',
          disconnect_reason: 'manual',
          connected_at: '2026-09-01T00:00:00Z',
          disconnected_at: '2026-10-20T00:00:00Z',
        },
      ],
    });

    renderPage();

    expect(await screen.findByText('Desconectado manualmente')).toBeInTheDocument();
    expect(screen.queryByText(/reconecte para voltar a receber metricas atualizadas/i)).not.toBeInTheDocument();
  });

  // Relinking after a revocation: clicking "Reconectar" starts the same OAuth flow as a
  // first-time connect, never asking for or substituting a stored credential.
  it('starts the same authorization flow to relink a disconnected account', async () => {
    (creatorPortalApi.listSocialAccounts as any).mockResolvedValue({
      data: [
        {
          platform: 'instagram',
          platform_handle: '@duda',
          status: 'disconnected',
          disconnect_reason: 'revoked_by_platform',
          connected_at: '2026-09-01T00:00:00Z',
          disconnected_at: '2026-10-20T00:00:00Z',
        },
      ],
    });
    (creatorPortalApi.authorizeSocialAccount as any).mockResolvedValue({
      authorize_url: 'https://aurora.com.br/_simulated-oauth/instagram?state=st-2',
      state: 'st-2',
    });

    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Desconectado');
    await user.click(screen.getByRole('button', { name: 'Reconectar' }));

    await waitFor(() => expect(creatorPortalApi.authorizeSocialAccount).toHaveBeenCalledWith('instagram'));
    expect(window.location.href).toBe('https://aurora.com.br/_simulated-oauth/instagram?state=st-2');
  });

  // Manual disconnect from this management page itself.
  it('lets her manually disconnect a currently-connected platform', async () => {
    (creatorPortalApi.listSocialAccounts as any).mockResolvedValue({
      data: [
        {
          platform: 'instagram',
          platform_handle: '@duda',
          status: 'connected',
          disconnect_reason: null,
          connected_at: '2026-09-01T00:00:00Z',
          disconnected_at: null,
        },
      ],
    });
    (creatorPortalApi.disconnectSocialAccount as any).mockResolvedValue(undefined);

    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Conectado');
    await user.click(screen.getByRole('button', { name: 'Desconectar' }));

    await waitFor(() => expect(creatorPortalApi.disconnectSocialAccount).toHaveBeenCalledWith('instagram'));
  });

  it('redirects to login when there is no creator session', async () => {
    const apiClient = await import('@/lib/api-client');
    (apiClient.getCreatorToken as any).mockReturnValueOnce(null);
    (creatorPortalApi.listSocialAccounts as any).mockResolvedValue({ data: [] });

    renderPage();

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/creator-portal/login'));
  });
});
