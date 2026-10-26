import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ContentSubmissionsPage } from './content-submissions-page';
import { contentSubmissionApi } from '@/lib/api-client';

vi.mock('@/lib/api-client', () => ({
  contentSubmissionApi: {
    list: vi.fn(),
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
      <MemoryRouter initialEntries={['/app/campaigns/camp-1/content-submissions']}>
        <Routes>
          <Route path="/app/campaigns/:id/content-submissions" element={<ContentSubmissionsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const v1Rejected = {
  id: 'sub-6001',
  version_number: 1,
  supersedes_submission_id: null,
  review_status: 'rejected' as const,
  review_reason: 'O produto nao aparece em nenhum momento do video.',
  review_decided_at: new Date().toISOString(),
  review_deadline_at: new Date().toISOString(),
  review_escalated: false,
  safety_gate: { cleared: true, blocking_reason: null },
  published_url: null,
  submitted_at: new Date().toISOString(),
  creator_display_name: 'Duda Oliveira',
  latest_version: false,
};

const v2Pending = {
  ...v1Rejected,
  id: 'sub-6010',
  version_number: 2,
  supersedes_submission_id: 'sub-6001',
  review_status: 'pending' as const,
  review_reason: null,
  review_decided_at: null,
  latest_version: true,
  safety_gate: { cleared: false, blocking_reason: 'pending' },
};

describe('ContentSubmissionsPage - US-19', () => {
  beforeEach(() => vi.clearAllMocks());

  // Hard: a later version's rejection reason must never be confused with an earlier version's
  // own reason (US-19 scenario 2 / US-33 scenario 2) -- expanding history shows v1's reason
  // attributed to v1 specifically, distinct from v2's own (pending) status.
  it('shows the current version by default and attributes each version its own reason on drill-down', async () => {
    (contentSubmissionApi.list as any).mockResolvedValue({
      data: [v1Rejected, v2Pending],
      pagination: { next_cursor: null, has_more: false },
    });

    renderPage();

    expect(await screen.findByText(/Duda Oliveira · versao 2/)).toBeInTheDocument();
    expect(screen.queryByText(/Duda Oliveira · versao 1/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Ver historico/ }));

    expect(await screen.findByText(/Duda Oliveira · versao 1/)).toBeInTheDocument();
    expect(
      screen.getByText('Motivo registrado para a versao 1: O produto nao aparece em nenhum momento do video.'),
    ).toBeInTheDocument();
  });

  // Failure: rejecting without a reason is refused; the reason is required before the decision
  // is finalized (US-19 scenario 3).
  it('requires a reason before confirming a rejection', async () => {
    (contentSubmissionApi.list as any).mockResolvedValue({
      data: [v2Pending],
      pagination: { next_cursor: null, has_more: false },
    });

    renderPage();
    await screen.findByText(/Duda Oliveira · versao 2/);

    await userEvent.click(screen.getByRole('button', { name: 'Rejeitar' }));
    const confirmButton = screen.getByRole('button', { name: 'Confirmar' });
    expect(confirmButton).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/Motivo da rejeicao/), 'Audio incompreensivel');
    expect(confirmButton).not.toBeDisabled();

    await userEvent.click(confirmButton);
    await waitFor(() =>
      expect(contentSubmissionApi.decide).toHaveBeenCalledWith('sub-6010', {
        decision: 'rejected',
        reason: 'Audio incompreensivel',
      }),
    );
  });

  // Normal: approving a draft requires no reason, and the safety-gate status renders
  // independently of the creative decision (section 2 of the architecture document).
  it('approves a draft with no reason required and shows the safety gate status alongside it', async () => {
    (contentSubmissionApi.list as any).mockResolvedValue({
      data: [v2Pending],
      pagination: { next_cursor: null, has_more: false },
    });
    (contentSubmissionApi.decide as any).mockResolvedValue({
      id: 'rev-1',
      content_submission_id: 'sub-6010',
      decision: 'approved',
      decided_at: new Date().toISOString(),
    });

    renderPage();
    await screen.findByText(/Duda Oliveira · versao 2/);

    expect(screen.getByText(/Seguranca: pending/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Aprovar' }));
    await waitFor(() =>
      expect(contentSubmissionApi.decide).toHaveBeenCalledWith('sub-6010', { decision: 'approved' }),
    );
  });
});
