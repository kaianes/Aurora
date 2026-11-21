import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';
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

describe('OnboardingAnalyzingPage - US-10.4 animated analyzing screen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // The analyzing screen is visible from the moment the page loads, regardless of
  // backend status -- the animation is not gated on a response.
  it('shows the analyzing screen heading immediately on mount', async () => {
    (creatorPortalApi.getOnboardingStatus as any).mockResolvedValue({ onboarding_status: 'pending' });

    renderPage();

    expect(screen.getByText(/Analisando seu perfil/i)).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  // The first step label must appear immediately (no delay before step 1).
  it('shows the first step label as soon as the page renders', async () => {
    (creatorPortalApi.getOnboardingStatus as any).mockResolvedValue({ onboarding_status: 'pending' });

    renderPage();

    // step 1 is active on first render
    expect(screen.getByText('Verificando autenticidade')).toBeInTheDocument();
  });

  // All four step labels must appear sequentially during the animation sequence.
  it('shows all four step labels during the animation', async () => {
    (creatorPortalApi.getOnboardingStatus as any).mockResolvedValue({ onboarding_status: 'pending' });

    renderPage();

    // All four labels are rendered (pending steps are visible at reduced opacity)
    expect(screen.getByText('Verificando autenticidade')).toBeInTheDocument();
    expect(screen.getByText('Calculando taxa de engajamento')).toBeInTheDocument();
    expect(screen.getByText('Avaliando composicao do publico')).toBeInTheDocument();
    expect(screen.getByText('Gerando sua pontuacao')).toBeInTheDocument();
  });

  // After ~5s the score reveal transitions in. For a qualified creator, the score and
  // a "Pontuacao de autenticidade" label are shown.
  it('shows the score reveal after the animation completes for a qualified creator', async () => {
    (creatorPortalApi.getOnboardingStatus as any).mockResolvedValue({
      onboarding_status: 'qualified',
      authenticity_score: 87,
      engagement_rate: '8.3%',
      audience_size: 18400,
    });

    renderPage();

    // Advance past the full animation sequence (5 s)
    await act(async () => {
      vi.advanceTimersByTime(5100);
    });
    // A second act flush ensures the useEffect that sets revealedScore has run
    // (ScoreRing has no internal state -- the parent effect updates the score directly)
    await act(async () => {});

    // "Pontuacao de autenticidade" label appears on the score reveal card
    expect(screen.getByText('Pontuacao de autenticidade')).toBeInTheDocument();
    // The numeric score is shown via data-testid (the span showing Math.round(score))
    expect(screen.getByTestId('score-value')).toHaveTextContent('87');
    // Navigation button to the result page is visible
    expect(screen.getByRole('button', { name: /Ver resultado completo/i })).toBeInTheDocument();
    // The step animation card is gone
    expect(screen.queryByText('Verificando autenticidade')).not.toBeInTheDocument();
  });

  // A not_qualified creator also sees the score reveal, but with the "Perfil ainda em
  // crescimento" message below the score (US-10.4 scenario 4 / architecture section 9).
  it('shows "Perfil ainda em crescimento" for a not_qualified creator', async () => {
    (creatorPortalApi.getOnboardingStatus as any).mockResolvedValue({
      onboarding_status: 'not_qualified',
      authenticity_score: 42,
    });

    renderPage();

    await act(async () => {
      vi.advanceTimersByTime(5100);
    });

    expect(screen.getByText(/Perfil ainda em crescimento/i)).toBeInTheDocument();
  });

  // If the score is null and status is still pending after the animation, the page
  // tells the creator their analysis is still running -- no broken widget (scenario 4).
  it('shows an "analysis in progress" message when score is null after animation', async () => {
    (creatorPortalApi.getOnboardingStatus as any).mockResolvedValue({
      onboarding_status: 'pending',
      authenticity_score: null,
    });

    renderPage();

    await act(async () => {
      vi.advanceTimersByTime(5100);
    });

    expect(screen.getByText(/levando mais tempo que o esperado/i)).toBeInTheDocument();
  });

  // After the score reveal, clicking "Ver resultado completo" navigates to the result page.
  // Uses fireEvent instead of userEvent to avoid userEvent's internal async
  // Promise chains timing out under fake timers.
  it('navigates to the result page when the creator clicks the continue button', async () => {
    (creatorPortalApi.getOnboardingStatus as any).mockResolvedValue({
      onboarding_status: 'qualified',
      authenticity_score: 87,
    });

    renderPage();

    await act(async () => {
      vi.advanceTimersByTime(5100);
    });
    await act(async () => {});

    const btn = screen.getByRole('button', { name: /Ver resultado completo/i });
    act(() => {
      fireEvent.click(btn);
    });

    expect(navigateMock).toHaveBeenCalledWith('/creator-portal/onboarding/result');
  });

  // Uses real timers for this test because waitFor polls with setInterval,
  // which hangs under fake timers unless manually advanced.
  it('redirects to login when there is no creator session', async () => {
    vi.useRealTimers();
    const apiClient = await import('@/lib/api-client');
    (apiClient.getCreatorToken as any).mockReturnValueOnce(null);
    (creatorPortalApi.getOnboardingStatus as any).mockResolvedValue({ onboarding_status: 'pending' });

    renderPage();

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/creator-portal/login'));
  });
});
