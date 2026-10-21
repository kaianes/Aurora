import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OnboardingAnalyzingPage } from './onboarding-analyzing-page';

const navigateMock = vi.fn();

vi.mock('@/lib/api-client', () => ({
  creatorPortalApi: {
    getOnboardingStatus: vi.fn(),
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
        <OnboardingAnalyzingPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('OnboardingAnalyzingPage - onboarding step 4 (US-24.2/US-24.3 wait screen)', () => {
  beforeEach(() => vi.clearAllMocks());

  // While the decision is still pending, she stays on the wait screen -- never navigated
  // away before a decision actually exists.
  it('keeps showing the wait screen while onboarding_status is pending', async () => {
    (creatorPortalApi.getOnboardingStatus as any).mockResolvedValue({ onboarding_status: 'pending' });

    renderPage();

    await screen.findByText(/Analisando seu perfil/i);
    expect(navigateMock).not.toHaveBeenCalled();
  });

  // The moment the decision resolves (qualified), she moves straight to the result step --
  // this is what makes the "immediately at the end of onboarding" promise (US-24.4) hold.
  it('navigates to the result step once qualification resolves to qualified', async () => {
    (creatorPortalApi.getOnboardingStatus as any).mockResolvedValue({ onboarding_status: 'qualified' });

    renderPage();

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/creator-portal/onboarding/result'));
  });

  // Equally, a not_qualified decision is not held back on this wait screen either -- she is
  // told promptly, not kept waiting past when the decision actually finished.
  it('navigates to the result step once qualification resolves to not_qualified', async () => {
    (creatorPortalApi.getOnboardingStatus as any).mockResolvedValue({ onboarding_status: 'not_qualified' });

    renderPage();

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/creator-portal/onboarding/result'));
  });

  it('redirects to login when there is no creator session', async () => {
    const apiClient = await import('@/lib/api-client');
    (apiClient.getCreatorToken as any).mockReturnValueOnce(null);
    (creatorPortalApi.getOnboardingStatus as any).mockResolvedValue({ onboarding_status: 'pending' });

    renderPage();

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/creator-portal/login'));
  });
});
