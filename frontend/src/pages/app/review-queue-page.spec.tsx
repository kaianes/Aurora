import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReviewQueuePage } from './review-queue-page';
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

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/app/safety/review-queue']}>
        <Routes>
          <Route path="/app/safety/review-queue" element={<ReviewQueuePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const multiRuleItem = {
  id: 'rq-1',
  content_submission_id: 'sub-1',
  campaign_id: 'camp-1',
  campaign_name: 'Lancamento Serum Vitamina C',
  creator_display_name: 'Duda Oliveira',
  reason_category: 'rule_violation',
  triggered_rules: [
    { rule_id: 'rule-007', rule_type: 'restricted_language', channel: 'audio', matched_excerpt: 'resultado garantido em uma semana' },
    { rule_id: 'rule-009', rule_type: 'prohibited_topic', channel: 'caption', matched_excerpt: 'testado em animais' },
  ],
  status: 'pending',
  created_at: new Date().toISOString(),
};

describe('ReviewQueuePage - US-17', () => {
  beforeEach(() => vi.clearAllMocks());

  // Hard: a submission triggering more than one rule lists every rule, not just the first (US-17 scenario 2).
  it('lists every triggered rule for an item, not just the first one found', async () => {
    (reviewQueueApi.list as any).mockResolvedValue({
      data: [multiRuleItem],
      pagination: { next_cursor: null, has_more: false },
    });

    renderPage();

    expect(await screen.findByText('Lancamento Serum Vitamina C')).toBeInTheDocument();
    expect(screen.getByText(/resultado garantido em uma semana/)).toBeInTheDocument();
    expect(screen.getByText(/testado em animais/)).toBeInTheDocument();
  });

  // Normal: a single flagged item can be approved, rejected with a reason, or sent back for revision (US-17 scenario 1).
  it('requires a reason before confirming a rejection', async () => {
    (reviewQueueApi.list as any).mockResolvedValue({
      data: [multiRuleItem],
      pagination: { next_cursor: null, has_more: false },
    });

    renderPage();
    await screen.findByText('Lancamento Serum Vitamina C');

    await userEvent.click(screen.getByRole('button', { name: 'Rejeitar' }));
    const confirmButton = screen.getByRole('button', { name: 'Confirmar' });
    expect(confirmButton).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/Motivo da rejeicao/), 'Linguagem de resultado garantido nao permitida');
    expect(confirmButton).not.toBeDisabled();

    await userEvent.click(confirmButton);
    await waitFor(() =>
      expect(reviewQueueApi.decide).toHaveBeenCalledWith('rq-1', {
        decision: 'rejected',
        reason: 'Linguagem de resultado garantido nao permitida',
      }),
    );
  });

  // Failure: the queue is unreachable. A failed refresh must show an explicit error and must never
  // make a previously loaded flagged item disappear or look resolved (US-17 scenario 3).
  it('shows an explicit error and keeps the flagged item visible when the queue becomes unreachable on refresh', async () => {
    (reviewQueueApi.list as any)
      .mockResolvedValueOnce({ data: [multiRuleItem], pagination: { next_cursor: null, has_more: false } })
      .mockRejectedValueOnce({
        isAxiosError: true,
        response: {
          status: 503,
          data: { error: { code: 'REVIEW_QUEUE_UNAVAILABLE', message: 'Servico de revisao indisponivel. Tente novamente.' } },
        },
      });
    (reviewQueueApi.decide as any).mockResolvedValue({ id: 'rq-1', status: 'approved', decided_at: new Date().toISOString() });

    renderPage();
    await screen.findByText('Lancamento Serum Vitamina C');

    // Approving triggers a refetch of the list, which this time fails (503).
    await userEvent.click(screen.getByRole('button', { name: 'Aprovar' }));

    expect(await screen.findByText(/Nao foi possivel carregar a fila de revisao agora/)).toBeInTheDocument();
    // The flagged item from the last successful load must still be visibly present, not emptied out.
    expect(screen.getByText('Lancamento Serum Vitamina C')).toBeInTheDocument();
    expect(screen.getByText(/permanece bloqueado e nao publicado/)).toBeInTheDocument();
    expect(screen.queryByText('Nenhum item nesta fila.')).not.toBeInTheDocument();
  });
});
