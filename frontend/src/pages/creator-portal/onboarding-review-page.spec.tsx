import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OnboardingReviewPage } from './onboarding-review-page';

const navigateMock = vi.fn();

vi.mock('@/lib/api-client', () => ({
  creatorPortalApi: {
    updateProfile: vi.fn(),
  },
  getCreatorToken: vi.fn(() => 'fake-creator-token'),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

import { creatorPortalApi } from '@/lib/api-client';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <OnboardingReviewPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('OnboardingReviewPage - onboarding step 3 (review/correct surfaced details)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('submits only the fields she actually filled in and advances to the analyzing step', async () => {
    (creatorPortalApi.updateProfile as any).mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/Nome de exibicao/i), 'Duda Oliveira');
    await user.click(screen.getByRole('button', { name: 'Continuar' }));

    await waitFor(() => {
      expect(creatorPortalApi.updateProfile).toHaveBeenCalledWith({ display_name: 'Duda Oliveira' });
    });
    expect(navigateMock).toHaveBeenCalledWith('/creator-portal/onboarding/analyzing');
  });

  it('lets her skip the review step entirely without calling the API', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Pular' }));

    expect(creatorPortalApi.updateProfile).not.toHaveBeenCalled();
    expect(navigateMock).toHaveBeenCalledWith('/creator-portal/onboarding/analyzing');
  });

  it('shows a retry-or-skip message when saving her corrections fails', async () => {
    (creatorPortalApi.updateProfile as any).mockRejectedValue(new Error('network error'));
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/Nicho de conteudo/i), 'skincare');
    await user.click(screen.getByRole('button', { name: 'Continuar' }));

    expect(await screen.findByText(/Voce pode tentar novamente ou pular esta etapa/i)).toBeInTheDocument();
  });

  it('redirects to login when there is no creator session', async () => {
    const apiClient = await import('@/lib/api-client');
    (apiClient.getCreatorToken as any).mockReturnValueOnce(null);
    renderPage();

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/creator-portal/login'));
  });
});
