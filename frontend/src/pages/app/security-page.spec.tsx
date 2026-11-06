import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SecurityPage } from './security-page';
import { authApi } from '@/lib/api-client';

vi.mock('@/lib/api-client', () => ({
  authApi: {
    mfaSetup: vi.fn(),
    mfaConfirm: vi.fn(),
  },
}));

let mockUser: { mfa_enabled: boolean } = { mfa_enabled: false };
const mockUpdateUser = vi.fn((patch: Partial<{ mfa_enabled: boolean }>) => {
  mockUser = { ...mockUser, ...patch };
});
vi.mock('@/contexts/auth-context', () => ({
  useAuth: () => ({ user: mockUser, updateUser: mockUpdateUser }),
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SecurityPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const setupResponse = {
  secret: 'JBSWY3DPEHPK3PXP',
  qr_code_url: 'otpauth://totp/Aurora:marina@acme.com.br?secret=JBSWY3DPEHPK3PXP&issuer=Aurora',
  backup_codes: ['11111111', '22222222'],
};

describe('SecurityPage (MFA activation, POST /auth/mfa/setup + /auth/mfa/confirm)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = { mfa_enabled: false };
  });

  it('shows MFA as enabled and never calls mfaSetup when the user already has it on', async () => {
    mockUser = { mfa_enabled: true };

    renderPage();

    expect(await screen.findByText('MFA esta ativado na sua conta.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ativar MFA' })).not.toBeInTheDocument();
    expect(authApi.mfaSetup).not.toHaveBeenCalled();
  });

  it('starts setup, showing the QR code, manual secret, and backup codes', async () => {
    (authApi.mfaSetup as any).mockResolvedValue(setupResponse);

    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'Ativar MFA' }));

    expect(await screen.findByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument();
    expect(screen.getByText('11111111')).toBeInTheDocument();
    expect(screen.getByText('22222222')).toBeInTheDocument();
    expect(screen.getByLabelText('Codigo de verificacao')).toBeInTheDocument();
  });

  it('confirms the code, marks MFA as enabled, and shows a success message', async () => {
    (authApi.mfaSetup as any).mockResolvedValue(setupResponse);
    (authApi.mfaConfirm as any).mockResolvedValue({ message: 'MFA ativado com sucesso.' });

    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'Ativar MFA' }));
    await screen.findByLabelText('Codigo de verificacao');
    await userEvent.type(screen.getByLabelText('Codigo de verificacao'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));

    expect(await screen.findByText('MFA ativado com sucesso.')).toBeInTheDocument();
    expect(authApi.mfaConfirm).toHaveBeenCalledWith({ code: '123456' });
    expect(mockUpdateUser).toHaveBeenCalledWith({ mfa_enabled: true });
  });

  it('shows an explicit error and keeps the setup flow open when confirmation fails', async () => {
    (authApi.mfaSetup as any).mockResolvedValue(setupResponse);
    (authApi.mfaConfirm as any).mockRejectedValue({
      isAxiosError: true,
      response: { data: { error: { message: 'Codigo MFA invalido. Tente novamente.' } } },
    });

    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'Ativar MFA' }));
    await screen.findByLabelText('Codigo de verificacao');
    await userEvent.type(screen.getByLabelText('Codigo de verificacao'), '000000');
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));

    expect(await screen.findByText('Codigo MFA invalido. Tente novamente.')).toBeInTheDocument();
    expect(mockUpdateUser).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Codigo de verificacao')).toBeInTheDocument();
  });

  it('shows an explicit error when starting setup fails', async () => {
    (authApi.mfaSetup as any).mockRejectedValue({
      isAxiosError: true,
      response: { data: { error: { message: 'Nao foi possivel iniciar a configuracao do MFA.' } } },
    });

    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'Ativar MFA' }));

    expect(await screen.findByText('Nao foi possivel iniciar a configuracao do MFA.')).toBeInTheDocument();
  });

  it('cancels setup and returns to the inactive state without confirming', async () => {
    (authApi.mfaSetup as any).mockResolvedValue(setupResponse);

    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'Ativar MFA' }));
    await screen.findByLabelText('Codigo de verificacao');
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(screen.queryByLabelText('Codigo de verificacao')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ativar MFA' })).toBeInTheDocument();
  });
});
