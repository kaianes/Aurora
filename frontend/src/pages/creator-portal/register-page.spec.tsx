import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RegisterPage } from './register-page';

vi.mock('@/lib/api-client', () => ({
  creatorPortalApi: {
    register: vi.fn(),
  },
}));

import { creatorPortalApi } from '@/lib/api-client';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/Nome completo/i), 'Duda Oliveira');
  await user.type(screen.getByLabelText(/^Email/i), 'duda@example.com');
  await user.type(screen.getByLabelText(/Senha/i), 'StrongP@ss1');
  await user.click(screen.getByRole('checkbox'));
}

describe('RegisterPage - US-24.1 step 1 (self-registration)', () => {
  beforeEach(() => vi.clearAllMocks());

  // Normal: successful registration shows the verify-email message (US-24.1 scenario 1,
  // registration half -- the OAuth half is covered on the link-accounts page).
  it('shows the verify-your-email message after a successful registration', async () => {
    (creatorPortalApi.register as any).mockResolvedValue({
      message: 'Conta criada com sucesso. Verifique seu email para ativar sua conta.',
      user_id: 'user-1',
    });
    const user = userEvent.setup();
    renderPage();

    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: 'Criar conta' }));

    expect(await screen.findByText(/Verifique seu email/i)).toBeInTheDocument();
    expect(creatorPortalApi.register).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'duda@example.com', accepted_terms: true }),
    );
  });

  // Client-side validation: weak password is rejected before any API call is made.
  it('rejects a weak password without calling the API', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/Nome completo/i), 'Duda Oliveira');
    await user.type(screen.getByLabelText(/^Email/i), 'duda@example.com');
    await user.type(screen.getByLabelText(/Senha/i), 'weak');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Criar conta' }));

    await waitFor(() => {
      expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    });
    expect(creatorPortalApi.register).not.toHaveBeenCalled();
  });

  // Client-side validation: terms must be accepted.
  it('requires terms acceptance before submitting', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/Nome completo/i), 'Duda Oliveira');
    await user.type(screen.getByLabelText(/^Email/i), 'duda@example.com');
    await user.type(screen.getByLabelText(/Senha/i), 'StrongP@ss1');
    await user.click(screen.getByRole('button', { name: 'Criar conta' }));

    await waitFor(() => {
      expect(screen.getByText(/precisa aceitar os termos/i)).toBeInTheDocument();
    });
    expect(creatorPortalApi.register).not.toHaveBeenCalled();
  });

  // Failure: a server-side error (e.g. transient failure) surfaces its message rather than
  // silently doing nothing.
  it('shows the server error message when registration fails', async () => {
    (creatorPortalApi.register as any).mockRejectedValue({
      isAxiosError: true,
      response: { data: { error: { code: 'INTERNAL_ERROR', message: 'Nao foi possivel criar sua conta agora.' } } },
    });
    const user = userEvent.setup();
    renderPage();

    await fillValidForm(user);
    await user.click(screen.getByRole('button', { name: 'Criar conta' }));

    expect(await screen.findByText('Nao foi possivel criar sua conta agora.')).toBeInTheDocument();
  });
});
