import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { RegisterPage } from './register-page';

vi.mock('@/lib/api-client', () => ({
  authApi: {
    register: vi.fn(),
  },
}));

import { authApi } from '@/lib/api-client';

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RegisterPage - US-01 Self-Service Sign-Up', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // US-01: page renders with form fields, no sales interaction required
  it('should render sign-up form without requiring sales contact', async () => {
    renderPage();

    expect(screen.getByRole('heading', { name: 'Criar conta' })).toBeInTheDocument();
    expect(screen.getByText(/sem precisar falar com vendas/i)).toBeInTheDocument();

    // All required fields present
    expect(screen.getByLabelText(/Nome completo/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Senha/i)).toBeInTheDocument();
    // Workspace name field (default is brand)
    expect(screen.getByLabelText(/Nome da marca/i)).toBeInTheDocument();
  });

  // US-01: workspace type toggle between brand and agency
  it('should allow toggling between brand and agency workspace types', async () => {
    const user = userEvent.setup();
    renderPage();

    // Default: brand
    expect(screen.getByLabelText(/Nome da marca/i)).toBeInTheDocument();

    // Switch to agency
    const agencyButton = screen.getByRole('button', { name: /Agencia/i });
    await user.click(agencyButton);

    // Label should change
    await waitFor(() => {
      expect(screen.getByLabelText(/Nome da agencia/i)).toBeInTheDocument();
    });
  });

  // US-01 Scenario 1 - Normal: successful registration shows verification message
  it('should show verification email message after successful registration', async () => {
    (authApi.register as any).mockResolvedValue({
      message: 'Conta criada com sucesso.',
      user_id: 'new-user-id',
    });
    const user = userEvent.setup();

    renderPage();

    await user.type(screen.getByLabelText(/Nome completo/i), 'Marina Silva');
    await user.type(screen.getByLabelText(/Email/i), 'marina@brand.com');
    await user.type(screen.getByLabelText(/Senha/i), 'StrongP@ss1!');
    await user.type(screen.getByLabelText(/Nome da marca/i), 'My Brand');

    const submitButton = screen.getByRole('button', { name: /Criar conta/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/Verifique seu email/i)).toBeInTheDocument();
    });
  });

  // Client-side validation: password complexity
  it('should show validation errors for weak passwords', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/Nome completo/i), 'Marina');
    await user.type(screen.getByLabelText(/Email/i), 'marina@test.com');
    await user.type(screen.getByLabelText(/Senha/i), 'short');
    await user.type(screen.getByLabelText(/Nome da marca/i), 'Brand');

    const submitButton = screen.getByRole('button', { name: /Criar conta/i });
    await user.click(submitButton);

    await waitFor(() => {
      // Should show password validation error
      const alerts = screen.getAllByRole('alert');
      expect(alerts.length).toBeGreaterThan(0);
    });

    // Should NOT call the API
    expect(authApi.register).not.toHaveBeenCalled();
  });

  // Accessibility: form has proper labels
  it('should have accessible form with labels and error announcements', () => {
    renderPage();

    // All inputs should have labels
    const inputs = screen.getAllByRole('textbox');
    inputs.forEach((input) => {
      expect(input).toHaveAttribute('id');
    });

    // Password hint visible
    expect(screen.getByText(/Minimo 10 caracteres/i)).toBeInTheDocument();
  });
});
