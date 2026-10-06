import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ShortlistPage } from './shortlist-page';
import { shortlistApi } from '@/lib/api-client';

vi.mock('@/lib/api-client', () => ({
  shortlistApi: {
    get: vi.fn(),
    request: vi.fn(),
    decide: vi.fn(),
    bulkDecide: vi.fn(),
    requestAdditionalCandidates: vi.fn(),
  },
}));

vi.mock('@/contexts/auth-context', () => ({
  useAuth: () => ({ currentRole: 'brand_manager' }),
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/app/campaigns/camp-1/shortlist']}>
        <Routes>
          <Route path="/app/campaigns/:id/shortlist" element={<ShortlistPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const baseEntry = {
  id: 'entry-1',
  creator_id: 'creator-9001',
  rank: 1,
  fit_score: 0.91,
  matched_attributes: ['interests:skincare'],
  origin: 'system_ranked',
  decision: 'pending',
  included: true,
};

describe('ShortlistPage - US-11', () => {
  beforeEach(() => vi.clearAllMocks());

  // Normal: a ready shortlist shows ranked entries with matched attributes (US-11 scenario 1, FR-26).
  it('renders the ranked entries with the attributes each creator satisfied', async () => {
    (shortlistApi.get as any).mockResolvedValue({
      id: 'sl-1',
      status: 'ready',
      below_guaranteed_minimum: false,
      locked: false,
      entries: [baseEntry],
      requested_at: new Date().toISOString(),
      resolved_at: new Date().toISOString(),
    });

    renderPage();

    expect(await screen.findByText(/Criador creator-9001/)).toBeInTheDocument();
    expect(screen.getByText(/interests:skincare/)).toBeInTheDocument();
    expect(screen.getByText(/Rank #1/)).toBeInTheDocument();
  });

  // Hard: pool below the guaranteed minimum is flagged explicitly, not padded silently (US-11 scenario 2).
  it('flags explicitly when the pool is below the guaranteed minimum', async () => {
    (shortlistApi.get as any).mockResolvedValue({
      id: 'sl-1',
      status: 'ready',
      below_guaranteed_minimum: true,
      guaranteed_min_pool_size: 10,
      matched_count: 3,
      locked: false,
      entries: [baseEntry],
      requested_at: new Date().toISOString(),
      resolved_at: new Date().toISOString(),
    });

    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent(/abaixo do minimo garantido/);
    expect(screen.getByText(/3 de 10 criadores/)).toBeInTheDocument();
  });

  // Failure: a failed generation tells the user explicitly rather than showing a blank list (US-11 scenario 3).
  it('shows an explicit failure message when shortlist generation failed', async () => {
    (shortlistApi.get as any).mockResolvedValue({
      id: 'sl-1',
      status: 'failed',
      failure_reason: 'Nao foi possivel gerar o shortlist agora. Tente novamente em alguns minutos.',
      below_guaranteed_minimum: false,
      locked: false,
      entries: [],
      requested_at: new Date().toISOString(),
      resolved_at: new Date().toISOString(),
    });

    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent(/Nao foi possivel gerar o shortlist/);
  });

  // US-13 scenario 1: approving/rejecting individual entries calls the decide API and clears prior errors.
  it('lets a brand manager approve an individual entry', async () => {
    (shortlistApi.get as any).mockResolvedValue({
      id: 'sl-1',
      status: 'ready',
      below_guaranteed_minimum: false,
      locked: false,
      entries: [baseEntry],
      requested_at: new Date().toISOString(),
      resolved_at: new Date().toISOString(),
    });
    (shortlistApi.decide as any).mockResolvedValue({ id: 'entry-1', decision: 'approved', included: true });

    renderPage();
    await screen.findByText(/Criador creator-9001/);

    await userEvent.click(screen.getByRole('button', { name: 'Aprovar' }));

    await waitFor(() =>
      expect(shortlistApi.decide).toHaveBeenCalledWith('camp-1', 'entry-1', { decision: 'approved' }),
    );
  });

  // US-13 scenario 3: once locked, no approve/reject controls are rendered at all.
  it('does not render approve/reject controls once the shortlist is locked', async () => {
    (shortlistApi.get as any).mockResolvedValue({
      id: 'sl-1',
      status: 'ready',
      below_guaranteed_minimum: false,
      locked: true,
      locked_reason: 'campaign_activated',
      entries: [{ ...baseEntry, decision: 'approved' }],
      requested_at: new Date().toISOString(),
      resolved_at: new Date().toISOString(),
    });

    renderPage();

    expect(await screen.findByText(/Shortlist bloqueado/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aprovar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rejeitar' })).not.toBeInTheDocument();
  });

  // Failure surfaced to the user: a decision rejected by the backend (locked shortlist) shows the explicit error text.
  it('shows an explicit error when a decision is rejected because the shortlist got locked mid-session', async () => {
    (shortlistApi.get as any).mockResolvedValue({
      id: 'sl-1',
      status: 'ready',
      below_guaranteed_minimum: false,
      locked: false,
      entries: [baseEntry],
      requested_at: new Date().toISOString(),
      resolved_at: new Date().toISOString(),
    });
    (shortlistApi.decide as any).mockRejectedValue({
      isAxiosError: true,
      response: { data: { error: { code: 'SHORTLIST_LOCKED_FOR_DECISIONS', message: 'As decisoes estao congeladas.' } } },
    });

    renderPage();
    await screen.findByText(/Criador creator-9001/);
    await userEvent.click(screen.getByRole('button', { name: 'Aprovar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/As decisoes estao congeladas/);
  });
});
