import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ShortlistOverridePage } from './shortlist-override-page';
import { shortlistApi } from '@/lib/api-client';

vi.mock('@/lib/api-client', () => ({
  shortlistApi: {
    get: vi.fn(),
    override: vi.fn(),
  },
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/app/campaigns/camp-1/shortlist/override']}>
        <Routes>
          <Route path="/app/campaigns/:id/shortlist/override" element={<ShortlistOverridePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const readyShortlist = {
  id: 'sl-1',
  status: 'ready',
  locked: false,
  guaranteed_min_pool_size: 2,
  entries: [
    { id: 'entry-1', creator_id: 'creator-1', rank: 1, fit_score: 0.9, matched_attributes: [], origin: 'system_ranked', decision: 'pending', included: true },
    { id: 'entry-2', creator_id: 'creator-2', rank: 2, fit_score: 0.8, matched_attributes: [], origin: 'system_ranked', decision: 'pending', included: true },
  ],
  requested_at: new Date().toISOString(),
  resolved_at: new Date().toISOString(),
};

describe('ShortlistOverridePage - US-40', () => {
  beforeEach(() => vi.clearAllMocks());

  // Normal: Renata removes a system-ranked creator and adds one from her own network, then saves (US-40 scenario 1).
  it('removes a system-ranked entry, adds a new creator, and saves the final selection', async () => {
    (shortlistApi.get as any).mockResolvedValue(readyShortlist);
    (shortlistApi.override as any).mockResolvedValue({ shortlist_id: 'sl-1', locked: true, locked_reason: 'agency_override' });

    renderPage();
    await screen.findByText(/Criador creator-1/);

    const removeButtons = screen.getAllByRole('button', { name: 'Remover' });
    await userEvent.click(removeButtons[0]);

    await userEvent.type(screen.getByLabelText('ID do criador na Aurora'), 'creator-7777');
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar' }));

    await userEvent.click(screen.getByRole('button', { name: 'Salvar selecao final' }));

    await waitFor(() =>
      expect(shortlistApi.override).toHaveBeenCalledWith('camp-1', {
        remove_entry_ids: ['entry-1'],
        add_creators: [{ creator_id: 'creator-7777' }],
      }),
    );
  });

  // Hard: once locked (saved), the page shows the shortlist as authoritative and does not offer another override (US-40 scenario 2).
  it('shows the shortlist as already locked and blocks a second override attempt', async () => {
    (shortlistApi.get as any).mockResolvedValue({ ...readyShortlist, locked: true, locked_reason: 'agency_override' });

    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent(/ja esta bloqueado.*override anterior/s);
    expect(screen.queryByRole('button', { name: 'Salvar selecao final' })).not.toBeInTheDocument();
  });

  // Failure: adding an ineligible creator is rejected with an explicit eligibility message, not silently added (US-40 scenario 3).
  it('shows an explicit eligibility error when the backend rejects an ineligible creator addition', async () => {
    (shortlistApi.get as any).mockResolvedValue(readyShortlist);
    (shortlistApi.override as any).mockRejectedValue({
      isAxiosError: true,
      response: {
        data: {
          error: {
            code: 'CREATOR_NOT_ELIGIBLE',
            message: 'O criador creator-9999 ainda nao completou a qualificacao de onboarding.',
            details: { creator_id: 'creator-9999', suggested_action: 'wait_for_onboarding' },
          },
        },
      },
    });

    renderPage();
    await screen.findByText(/Criador creator-1/);

    await userEvent.type(screen.getByLabelText('ID do criador na Aurora'), 'creator-9999');
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Salvar selecao final' }));

    expect(await screen.findByText(/nao completou a qualificacao de onboarding/)).toBeInTheDocument();
  });
});
