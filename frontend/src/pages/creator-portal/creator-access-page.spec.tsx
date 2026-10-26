import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CreatorAccessPage } from './creator-access-page';

const navigateMock = vi.fn();

vi.mock('@/lib/api-client', () => ({
  creatorPortalApi: {
    login: vi.fn(),
  },
  setCreatorToken: vi.fn(),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

import { creatorPortalApi, setCreatorToken } from '@/lib/api-client';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <CreatorAccessPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/**
 * ADR-0050: real email/password login replaces the former creator_id-only stub
 * (POST /creator-portal/login { creator_id }). These tests confirm the frontend drives a
 * genuine credential check rather than any bare-id shortcut -- a raw creator_id is never
 * sent or accepted here, only email/password.
 */
describe('CreatorAccessPage - US-24.1 real creator login (replaces the E3 pilot stub)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Normal: valid credentials store the real JWT and move on to the opportunities list.
  it('logs in with email and password, stores the token, and navigates to opportunities', async () => {
    (creatorPortalApi.login as any).mockResolvedValue({ access_token: 'real-jwt', expires_in: 900 });
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/Email/i), 'duda@example.com');
    await user.type(screen.getByLabelText(/Senha/i), 'StrongP@ss1');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));

    await waitFor(() => {
      // react-query's mutationFn is invoked with (variables, mutationFnContext) -- only the
      // first argument is this page's own concern.
      expect(creatorPortalApi.login).toHaveBeenCalledWith(
        { email: 'duda@example.com', password: 'StrongP@ss1' },
        expect.anything(),
      );
    });
    expect(setCreatorToken).toHaveBeenCalledWith('real-jwt');
    expect(navigateMock).toHaveBeenCalledWith('/creator-portal/opportunities');
  });

  // Failure: wrong password is rejected with a credential error, never silently accepted.
  it('shows an invalid-credentials message for a wrong password', async () => {
    (creatorPortalApi.login as any).mockRejectedValue({
      isAxiosError: true,
      response: { data: { error: { code: 'INVALID_CREDENTIALS', message: 'Email ou senha invalidos.' } } },
    });
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/Email/i), 'duda@example.com');
    await user.type(screen.getByLabelText(/Senha/i), 'WrongPassword1!');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByText('Email ou senha invalidos.')).toBeInTheDocument();
    expect(setCreatorToken).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  // Failure: an unverified account is told explicitly to check her email, not given a
  // generic credentials error.
  it('shows an explicit verify-your-email prompt for an unverified account', async () => {
    (creatorPortalApi.login as any).mockRejectedValue({
      isAxiosError: true,
      response: {
        data: {
          error: {
            code: 'EMAIL_NOT_VERIFIED',
            message: 'Sua conta ainda nao foi verificada. Verifique seu email.',
          },
        },
      },
    });
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/Email/i), 'duda@example.com');
    await user.type(screen.getByLabelText(/Senha/i), 'StrongP@ss1');
    await user.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByText(/Verifique seu email antes de fazer login/i)).toBeInTheDocument();
  });
});
