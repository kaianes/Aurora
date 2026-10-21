import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CreatorVerifyEmailPage } from './verify-email-page';

const navigateMock = vi.fn();
let searchParamsValue = '';

vi.mock('@/lib/api-client', () => ({
  creatorPortalApi: {
    verifyEmail: vi.fn(),
  },
  setCreatorToken: vi.fn(),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useSearchParams: () => [new URLSearchParams(searchParamsValue), vi.fn()],
  };
});

import { creatorPortalApi, setCreatorToken } from '@/lib/api-client';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <CreatorVerifyEmailPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CreatorVerifyEmailPage - email verification (section 5.2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParamsValue = '';
  });

  // Normal: a valid token verifies, stores the issued session token, and moves her straight
  // into onboarding step 2 (link accounts) -- no second login round trip required.
  it('verifies a valid token and advances to link-accounts', async () => {
    searchParamsValue = 'token=valid-token';
    (creatorPortalApi.verifyEmail as any).mockResolvedValue({
      message: 'Email verificado com sucesso.',
      access_token: 'session-jwt',
      expires_in: 900,
    });

    renderPage();

    await waitFor(() => {
      // react-query's mutationFn is invoked with (variables, mutationFnContext) -- only the
      // first argument is this page's own concern.
      expect(creatorPortalApi.verifyEmail).toHaveBeenCalledWith({ token: 'valid-token' }, expect.anything());
    });
    expect(setCreatorToken).toHaveBeenCalledWith('session-jwt');
    expect(navigateMock).toHaveBeenCalledWith('/creator-portal/onboarding/link-accounts');
  });

  // Failure: no token at all in the link -- never silently calls the API with an empty value.
  it('shows an explicit error when no token is present in the URL', async () => {
    searchParamsValue = '';
    renderPage();

    expect(await screen.findByText(/Token de verificacao ausente/i)).toBeInTheDocument();
    expect(creatorPortalApi.verifyEmail).not.toHaveBeenCalled();
  });

  // Failure: an expired or already-used token is rejected with a clear, specific message --
  // not a confusing generic failure.
  it('shows a clear message for an expired or already-used verification token', async () => {
    searchParamsValue = 'token=expired-token';
    (creatorPortalApi.verifyEmail as any).mockRejectedValue({
      isAxiosError: true,
      response: {
        data: {
          error: {
            code: 'VERIFICATION_EXPIRED',
            message: 'O link de verificacao expirou. Solicite um novo link.',
          },
        },
      },
    });

    renderPage();

    expect(await screen.findByText('O link de verificacao expirou. Solicite um novo link.')).toBeInTheDocument();
    expect(setCreatorToken).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
