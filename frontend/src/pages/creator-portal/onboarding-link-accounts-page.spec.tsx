import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OnboardingLinkAccountsPage } from './onboarding-link-accounts-page';

const navigateMock = vi.fn();
let searchParamsValue = '';
const setSearchParamsMock = vi.fn();

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
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useSearchParams: () => [new URLSearchParams(searchParamsValue), setSearchParamsMock],
  };
});

import { creatorPortalApi } from '@/lib/api-client';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <OnboardingLinkAccountsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const originalLocation = window.location;

describe('OnboardingLinkAccountsPage - US-24.1 onboarding step 2 (link social accounts)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParamsValue = '';
    // @ts-expect-error -- jsdom location is reassignable for the purpose of this test only.
    delete window.location;
    // @ts-expect-error -- see above.
    window.location = { ...originalLocation, href: '' };
  });

  // Normal (scenario 1): starting the connect flow sends her to the platform's own
  // authorization screen (here, the simulated one this pilot's stub adapter serves) --
  // never a password field of Aurora's own.
  it('redirects to the authorization URL when she starts connecting a platform', async () => {
    (creatorPortalApi.listSocialAccounts as any).mockResolvedValue({ data: [] });
    (creatorPortalApi.authorizeSocialAccount as any).mockResolvedValue({
      authorize_url: 'https://aurora.com.br/_simulated-oauth/instagram?state=st-1',
      state: 'st-1',
    });

    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Instagram');
    await user.click(screen.getAllByRole('button', { name: 'Conectar' })[0]);

    await waitFor(() => {
      expect(creatorPortalApi.authorizeSocialAccount).toHaveBeenCalledWith('instagram');
    });
    expect(window.location.href).toBe('https://aurora.com.br/_simulated-oauth/instagram?state=st-1');
  });

  // Hard (scenario 2, the manual-disconnect half): disconnecting one already-connected
  // platform does not block her from continuing, because another required account is still
  // connected -- "Continuar" stays enabled on at least one connection.
  it('keeps the continue button enabled after disconnecting one platform while another stays connected', async () => {
    (creatorPortalApi.listSocialAccounts as any).mockResolvedValue({
      data: [
        { platform: 'instagram', platform_handle: '@duda', status: 'connected', disconnect_reason: null, connected_at: '2026-10-01T00:00:00Z', disconnected_at: null },
        { platform: 'tiktok', platform_handle: '@duda.tok', status: 'connected', disconnect_reason: null, connected_at: '2026-10-01T00:00:00Z', disconnected_at: null },
      ],
    });
    (creatorPortalApi.disconnectSocialAccount as any).mockResolvedValue(undefined);

    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Instagram');
    expect(screen.getByRole('button', { name: 'Continuar' })).not.toBeDisabled();

    await user.click(screen.getAllByRole('button', { name: 'Desconectar' })[0]);

    await waitFor(() => expect(creatorPortalApi.disconnectSocialAccount).toHaveBeenCalledWith('instagram'));
    // TikTok is still connected, so onboarding status is not silently broken by the disconnect.
    expect(screen.getByRole('button', { name: 'Continuar' })).not.toBeDisabled();
  });

  // Failure (scenario 3): denial names the specific platform and does not block her from
  // continuing with whichever platforms she already connected successfully.
  it('names the specific platform on denial and lets her continue with already-connected platforms', async () => {
    searchParamsValue = 'platform=tiktok&result=denied';
    (creatorPortalApi.listSocialAccounts as any).mockResolvedValue({
      data: [
        { platform: 'instagram', platform_handle: '@duda', status: 'connected', disconnect_reason: null, connected_at: '2026-10-01T00:00:00Z', disconnected_at: null },
      ],
    });

    renderPage();

    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent(/Voce negou a autorizacao para/i);
    expect(banner).toHaveTextContent('TikTok');
    expect(screen.getByRole('button', { name: 'Continuar' })).not.toBeDisabled();
  });

  // Failure (scenario 3, platform unavailable half): an unavailable platform is named
  // explicitly too, and is never treated as a registration failure -- she can retry.
  it('names the specific platform when the platform itself is unavailable, offering retry', async () => {
    searchParamsValue = 'platform=youtube&result=unavailable';
    (creatorPortalApi.listSocialAccounts as any).mockResolvedValue({ data: [] });

    renderPage();

    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent(/indisponivel no momento para/i);
    expect(banner).toHaveTextContent('YouTube');
    // No connection exists yet, so continuing is correctly disabled -- but a retry ("Conectar")
    // button for every platform, including the failed one, is still available.
    expect(screen.getAllByRole('button', { name: 'Conectar' }).length).toBe(3);
  });

  // Disabled continue until at least one platform is connected.
  it('disables continue until at least one platform is connected', async () => {
    (creatorPortalApi.listSocialAccounts as any).mockResolvedValue({ data: [] });

    renderPage();

    await screen.findByText('Instagram');
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();
  });

  // Redirects to login when there is no creator session at all.
  it('redirects to login when no creator token is present', async () => {
    const apiClient = await import('@/lib/api-client');
    (apiClient.getCreatorToken as any).mockReturnValueOnce(null);
    (creatorPortalApi.listSocialAccounts as any).mockResolvedValue({ data: [] });

    renderPage();

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/creator-portal/login'));
  });
});
