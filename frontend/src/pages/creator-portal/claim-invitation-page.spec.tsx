import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ClaimInvitationPage } from './claim-invitation-page';

const navigateMock = vi.fn();

vi.mock('@/lib/api-client', () => ({
  creatorPortalApi: {
    getInvitation: vi.fn(),
    confirmInvitation: vi.fn(),
    declineInvitation: vi.fn(),
  },
  setCreatorToken: vi.fn(),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useParams: () => ({ token: 'tok-1' }),
  };
});

import { creatorPortalApi, setCreatorToken } from '@/lib/api-client';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ClaimInvitationPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const importedData = {
  display_name: 'Duda Oliveira',
  platform: 'instagram',
  observed_handle: '@duda.oliveira',
  observed_follower_count: 8400,
  observed_niche: 'beleza e skincare',
};

describe('ClaimInvitationPage - US-23.2 Invitation and Claim Flow', () => {
  beforeEach(() => vi.clearAllMocks());

  // Normal (scenario 1): she is shown exactly what was imported, and the profile only
  // becomes active after she confirms -- not automatically on viewing the invitation.
  it('shows the exact imported data for review and only activates on confirmation', async () => {
    (creatorPortalApi.getInvitation as any).mockResolvedValue({
      invitation_id: 'inv-1',
      status: 'pending',
      imported_data: importedData,
    });
    (creatorPortalApi.confirmInvitation as any).mockResolvedValue({
      creator_id: 'creator-5001',
      status: 'active',
      access_token: 'claim-jwt',
      expires_in: 900,
      message: 'Verifique seu email para confirmar sua conta.',
    });

    renderPage();

    expect(await screen.findByText('@duda.oliveira')).toBeInTheDocument();
    expect(screen.getByText('8.400')).toBeInTheDocument();
    expect(screen.getByText('beleza e skincare')).toBeInTheDocument();
    // Nothing is activated yet -- confirmInvitation has not been called just from viewing.
    expect(creatorPortalApi.confirmInvitation).not.toHaveBeenCalled();

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Seu email/i), 'duda@gmail.com');
    await user.type(screen.getByLabelText(/Crie uma senha/i), 'StrongP@ss1');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Confirmar e ativar meu perfil' }));

    await waitFor(() => expect(creatorPortalApi.confirmInvitation).toHaveBeenCalled());
    expect(setCreatorToken).toHaveBeenCalledWith('claim-jwt');
    expect(navigateMock).toHaveBeenCalledWith('/creator-portal/onboarding/link-accounts');
  });

  // Hard (scenario 2): she corrects the display name and niche (more than one field wrong);
  // the corrections sent are authoritative, never merged with Aurora's original guess.
  it('sends her corrections for multiple fields as the authoritative values, not merged with the import', async () => {
    (creatorPortalApi.getInvitation as any).mockResolvedValue({
      invitation_id: 'inv-1',
      status: 'pending',
      imported_data: importedData,
    });
    (creatorPortalApi.confirmInvitation as any).mockResolvedValue({
      creator_id: 'creator-5001',
      status: 'active',
      access_token: 'claim-jwt',
      expires_in: 900,
      message: 'Verifique seu email para confirmar sua conta.',
    });

    renderPage();
    await screen.findByText('@duda.oliveira');

    const user = userEvent.setup();
    const nameInput = screen.getByLabelText(/Nome de exibicao/i);
    await user.clear(nameInput);
    await user.type(nameInput, 'Duda M. Oliveira');
    const nicheInput = screen.getByLabelText(/Nicho de conteudo/i);
    await user.clear(nicheInput);
    await user.type(nicheInput, 'skincare e maquiagem');
    await user.type(screen.getByLabelText(/Seu email/i), 'duda@gmail.com');
    await user.type(screen.getByLabelText(/Crie uma senha/i), 'StrongP@ss1');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Confirmar e ativar meu perfil' }));

    await waitFor(() => {
      expect(creatorPortalApi.confirmInvitation).toHaveBeenCalledWith('tok-1', expect.objectContaining({
        corrections: {
          display_name: 'Duda M. Oliveira',
          content_niche: 'skincare e maquiagem',
        },
      }));
    });
  });

  // Failure (scenario 3): declining is recorded, nothing is activated, and she is told her
  // imported data was removed -- she is never left on a dead-end or confusing screen.
  it('records a decline, shows the data-removed confirmation, and never calls confirm', async () => {
    (creatorPortalApi.getInvitation as any).mockResolvedValue({
      invitation_id: 'inv-1',
      status: 'pending',
      imported_data: importedData,
    });
    (creatorPortalApi.declineInvitation as any).mockResolvedValue({ status: 'declined' });

    renderPage();
    await screen.findByText('@duda.oliveira');

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Recusar' }));

    expect(await screen.findByText(/Convite recusado/i)).toBeInTheDocument();
    expect(screen.getByText(/Removemos os dados/i)).toBeInTheDocument();
    expect(creatorPortalApi.declineInvitation).toHaveBeenCalledWith('tok-1');
    expect(creatorPortalApi.confirmInvitation).not.toHaveBeenCalled();
  });

  // Failure: an expired or already-used invitation token shows a clear, specific message --
  // not a confusing generic error -- and offers no form to fill out.
  it('shows a clear expired/already-answered message for a 410, with no form rendered', async () => {
    (creatorPortalApi.getInvitation as any).mockRejectedValue({
      isAxiosError: true,
      response: { status: 410, data: { error: { code: 'INVITATION_EXPIRED', message: 'Este convite nao esta mais disponivel.' } } },
    });

    renderPage();

    expect(await screen.findByText('Este convite expirou ou ja foi respondido.')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Crie uma senha/i)).not.toBeInTheDocument();
  });

  // Failure: an unknown token (never issued) also fails clearly rather than crashing or
  // rendering a blank form.
  it('shows a not-found message for an unknown invitation token', async () => {
    (creatorPortalApi.getInvitation as any).mockRejectedValue({
      isAxiosError: true,
      response: { status: 404, data: { error: { code: 'INVITATION_NOT_FOUND', message: 'Convite nao encontrado.' } } },
    });

    renderPage();

    expect(await screen.findByText('Convite nao encontrado.')).toBeInTheDocument();
  });
});
