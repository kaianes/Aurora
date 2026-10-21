import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OnboardingResultPage } from './onboarding-result-page';

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
        <OnboardingResultPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('OnboardingResultPage - US-24.4 Qualification Decision at the End of Onboarding', () => {
  beforeEach(() => vi.clearAllMocks());

  // Normal (scenario 1): she is told immediately that she qualifies, within the same
  // session -- real metrics shown, not a placeholder.
  it('tells her she qualifies and shows her real computed metrics', async () => {
    (creatorPortalApi.getOnboardingStatus as any).mockResolvedValue({
      onboarding_status: 'qualified',
      status: 'active',
      linked_platforms: ['instagram'],
      audience_size: 8400,
      engagement_rate: '2.3',
      authenticity_score: 81,
      authenticity_status: 'scored',
      qualification_decided_at: '2026-10-21T10:04:12Z',
    });

    renderPage();

    expect(await screen.findByText('Voce esta qualificada')).toBeInTheDocument();
    expect(screen.getByText(/8\.400/)).toBeInTheDocument();
    expect(screen.getByText(/2\.3%/)).toBeInTheDocument();
    expect(screen.getByText(/81/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver oportunidades' })).toBeInTheDocument();
  });

  // Hard (scenario 2): she does not qualify -- the specific missing criteria are named, not
  // a generic rejection message.
  it('names the specific missing criteria, not a generic rejection, when she does not qualify', async () => {
    (creatorPortalApi.getOnboardingStatus as any).mockResolvedValue({
      onboarding_status: 'not_qualified',
      qualification_missing_criteria: ['min_engagement_rate', 'min_audience_size'],
      qualification_decided_at: '2026-10-21T10:04:12Z',
    });

    renderPage();

    expect(await screen.findByText('Ainda nao qualificada')).toBeInTheDocument();
    expect(screen.getByText('Taxa de engajamento minima')).toBeInTheDocument();
    expect(screen.getByText('Tamanho minimo de audiencia')).toBeInTheDocument();
    // Never a vague, unnamed rejection.
    expect(screen.queryByText(/motivo nao especificado/i)).not.toBeInTheDocument();
  });

  // Humanizes an unknown criterion key gracefully rather than fabricating a translation.
  it('humanizes an unrecognized missing-criterion key rather than inventing a label for it', async () => {
    (creatorPortalApi.getOnboardingStatus as any).mockResolvedValue({
      onboarding_status: 'not_qualified',
      qualification_missing_criteria: ['min_future_criterion'],
      qualification_decided_at: '2026-10-21T10:04:12Z',
    });

    renderPage();

    expect(await screen.findByText('min future criterion')).toBeInTheDocument();
  });

  // Failure (scenario 3): the decision cannot be made yet -- she is given an expected
  // timeframe and a way to check again, never left with an undetermined status and no
  // communication, and never blocked indefinitely.
  it('tells her the decision is pending with an expected timeframe and a way to check again', async () => {
    (creatorPortalApi.getOnboardingStatus as any).mockResolvedValue({
      onboarding_status: 'pending',
      qualification_expected_ready_at: '2026-10-21T10:09:00Z',
      message: 'Ainda estamos analisando seu perfil. Avisaremos por email quando a decisao estiver pronta.',
    });

    renderPage();

    expect(await screen.findByText(/Ainda estamos analisando seu perfil/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verificar novamente' })).toBeInTheDocument();
  });

  it('lets her manually re-check a pending decision', async () => {
    (creatorPortalApi.getOnboardingStatus as any).mockResolvedValue({
      onboarding_status: 'pending',
      qualification_expected_ready_at: '2026-10-21T10:09:00Z',
    });

    const user = userEvent.setup();
    renderPage();

    await screen.findByRole('button', { name: 'Verificar novamente' });
    await user.click(screen.getByRole('button', { name: 'Verificar novamente' }));

    await waitFor(() => expect((creatorPortalApi.getOnboardingStatus as any).mock.calls.length).toBeGreaterThan(1));
  });

  it('redirects to login when there is no creator session', async () => {
    const apiClient = await import('@/lib/api-client');
    (apiClient.getCreatorToken as any).mockReturnValueOnce(null);
    (creatorPortalApi.getOnboardingStatus as any).mockResolvedValue({ onboarding_status: 'pending' });

    renderPage();

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/creator-portal/login'));
  });
});
