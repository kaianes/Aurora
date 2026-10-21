import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReviewQueueDetailPage } from './review-queue-detail-page';
import { reviewQueueApi } from '@/lib/api-client';

vi.mock('@/lib/api-client', () => ({
  reviewQueueApi: {
    list: vi.fn(),
    get: vi.fn(),
    decide: vi.fn(),
  },
}));

vi.mock('@/contexts/auth-context', () => ({
  useAuth: () => ({ currentRole: 'brand_manager' }),
}));

function renderPage(id = 'rq-1') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/app/safety/review-queue/${id}`]}>
        <Routes>
          <Route path="/app/safety/review-queue/:id" element={<ReviewQueueDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const multiRuleDetail = {
  id: 'rq-1',
  content_submission_id: 'sub-1',
  campaign_id: 'camp-1',
  campaign_name: 'Lancamento Serum Vitamina C',
  creator_display_name: 'Duda Oliveira',
  reason_category: 'rule_violation',
  caption_text: 'Produto sem testes em animais, resultado garantido',
  on_screen_text: null,
  audio_transcript: null,
  tier_reached: 'tier1',
  triggered_rules: [
    { rule_id: 'rule-007', rule_type: 'restricted_language', channel: 'audio', matched_excerpt: 'resultado garantido em uma semana' },
    { rule_id: 'rule-009', rule_type: 'prohibited_topic', channel: 'caption', matched_excerpt: 'testado em animais' },
  ],
  status: 'pending',
  created_at: new Date().toISOString(),
};

describe('ReviewQueueDetailPage - US-17', () => {
  beforeEach(() => vi.clearAllMocks());

  // Hard: a flagged item's full detail view lists every rule triggered, not just the first
  // (US-17 scenario 2), informing Marina's decision with the full picture.
  it('lists every triggered rule in the full detail view, not just the first', async () => {
    (reviewQueueApi.get as any).mockResolvedValue(multiRuleDetail);

    renderPage();

    expect(await screen.findByText('Lancamento Serum Vitamina C')).toBeInTheDocument();
    expect(screen.getByText(/resultado garantido em uma semana/)).toBeInTheDocument();
    expect(screen.getByText(/testado em animais/)).toBeInTheDocument();
  });

  // Normal: a single-rule item can be approved from the detail view.
  it('approves a single flagged item from the detail view', async () => {
    const singleRuleDetail = { ...multiRuleDetail, triggered_rules: [multiRuleDetail.triggered_rules[0]] };
    (reviewQueueApi.get as any).mockResolvedValue(singleRuleDetail);
    (reviewQueueApi.decide as any).mockResolvedValue({ id: 'rq-1', status: 'approved', decided_at: new Date().toISOString() });

    renderPage();
    await screen.findByText('Lancamento Serum Vitamina C');

    await userEvent.click(screen.getByRole('button', { name: 'Aprovar' }));
    await waitFor(() => expect(reviewQueueApi.decide).toHaveBeenCalledWith('rq-1', { decision: 'approved' }));
  });

  // Failure: the review queue is unreachable when Marina attempts to view a flagged item's
  // detail. She must see a clear error, and the item must not be implied to be empty or
  // resolved as a side effect of this failure (US-17 scenario 3).
  it('shows a clear error, never a blank page, when the item cannot be loaded', async () => {
    (reviewQueueApi.get as any).mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 503,
        data: { error: { code: 'REVIEW_QUEUE_UNAVAILABLE', message: 'Servico de revisao indisponivel.' } },
      },
    });

    renderPage();

    expect(await screen.findByText(/Nao foi possivel carregar este item da fila de revisao agora/)).toBeInTheDocument();
    expect(screen.getByText(/permanece bloqueado e nao publicado/)).toBeInTheDocument();
    // No decision controls are rendered -- she cannot be misled into thinking a decision was made.
    expect(screen.queryByRole('button', { name: 'Aprovar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rejeitar' })).not.toBeInTheDocument();
  });

  // Failure: attempting to decide on an item that is unreachable (the fetch itself fails) must
  // not silently succeed or default to any resolved state -- the retry control is the only path
  // forward, not an automatic approval/rejection.
  it('offers a retry action rather than any automatic resolution when the detail fails to load', async () => {
    (reviewQueueApi.get as any).mockRejectedValue({
      isAxiosError: true,
      response: { status: 503, data: { error: { code: 'REVIEW_QUEUE_UNAVAILABLE', message: 'indisponivel' } } },
    });

    renderPage();

    const retryButton = await screen.findByRole('button', { name: 'Tentar novamente' });
    expect(retryButton).toBeInTheDocument();
    expect(reviewQueueApi.decide).not.toHaveBeenCalled();
  });
});
