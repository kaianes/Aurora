import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DraftsPage } from './drafts-page';
import { creatorPortalApi } from '@/lib/api-client';

vi.mock('@/lib/api-client', () => ({
  creatorPortalApi: {
    listOpportunities: vi.fn(),
    listSubmissions: vi.fn(),
  },
  getCreatorToken: vi.fn(() => 'fake-creator-token'),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});

function renderPage(search = '?opportunity_id=opp-1') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/creator-portal/drafts${search}`]}>
        <DraftsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const acceptedOpportunity = {
  id: 'opp-1',
  campaign_id: 'camp-1234',
  brand_name: 'Acme Cosmeticos',
  deliverable: { format: 'instagram_reel', quantity: 1 },
  payout_gross: '800.00',
  payout_commission: '120.00',
  payout_net: '680.00',
  expires_at: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
  status: 'accepted' as const,
};

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
  submitted_at: '2026-10-21T09:00:00Z',
};

const v2Pending = {
  ...v1Rejected,
  id: 'sub-6010',
  version_number: 2,
  supersedes_submission_id: 'sub-6001',
  review_status: 'pending' as const,
  review_reason: null,
  review_escalated: false,
  safety_gate: { cleared: false, blocking_reason: 'pending' },
  submitted_at: '2026-10-22T10:00:00Z',
};

describe('DraftsPage - US-32a/US-32b/US-33', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (creatorPortalApi.listOpportunities as any).mockResolvedValue({ data: [acceptedOpportunity] });
  });

  // Hard: every version stays on the page with its own status and reason -- an earlier
  // rejection's reason is never confused with a later, still-pending version (US-32a scenario 2,
  // US-33 scenario 2).
  it('shows every version with its own status and attributes the rejection reason to the exact version it applies to', async () => {
    (creatorPortalApi.listSubmissions as any).mockResolvedValue({ data: [v1Rejected, v2Pending] });

    renderPage();

    expect(await screen.findByText('Versao 1')).toBeInTheDocument();
    expect(screen.getByText('Versao 2')).toBeInTheDocument();
    expect(
      screen.getByText('Motivo registrado para a versao 1: O produto nao aparece em nenhum momento do video.'),
    ).toBeInTheDocument();
    // Version 2's own card has no reason of its own, and v1's reason is never duplicated onto it.
    const v2Card = screen.getByText('Versao 2').closest('div')!.parentElement!;
    expect(v2Card.textContent).not.toContain('O produto nao aparece');
  });

  // Normal: the stated review deadline is visible, not merely a pending status with no
  // timeframe (US-32b scenario 1).
  it('shows the stated review deadline on a pending version', async () => {
    (creatorPortalApi.listSubmissions as any).mockResolvedValue({ data: [v2Pending] });

    renderPage();

    expect(await screen.findByText(/Prazo de revisao:/)).toBeInTheDocument();
  });

  // Hard: when the deadline has been breached, Duda's own view reflects the escalation
  // explicitly, never leaving it silently pending with no visible change (US-32b scenario 2).
  it('shows the escalation notice when a version has been escalated', async () => {
    (creatorPortalApi.listSubmissions as any).mockResolvedValue({
      data: [{ ...v2Pending, review_escalated: true }],
    });

    renderPage();

    expect(
      await screen.findByText(/a revisao foi escalada/),
    ).toBeInTheDocument();
  });

  // Normal: a resubmission action is offered only once the latest version has actually been
  // rejected or had revision requested, never while a version is still pending or approved
  // (ADR-0025's resubmission precondition, US-32a scenario 2).
  it('offers resubmission only when the latest version was rejected or needs revision', async () => {
    (creatorPortalApi.listSubmissions as any).mockResolvedValue({ data: [v1Rejected] });

    renderPage();

    expect(await screen.findByRole('link', { name: 'Enviar nova versao' })).toBeInTheDocument();
  });

  it('does not offer resubmission while the latest version is still pending', async () => {
    (creatorPortalApi.listSubmissions as any).mockResolvedValue({ data: [v1Rejected, v2Pending] });

    renderPage();
    await screen.findByText('Versao 2');

    expect(screen.queryByRole('link', { name: 'Enviar nova versao' })).not.toBeInTheDocument();
  });

  // Normal: once the latest version is approved and not yet published, the publication
  // confirmation action becomes available (feeds into US-34).
  it('offers publication confirmation once the latest version is approved and not yet published', async () => {
    (creatorPortalApi.listSubmissions as any).mockResolvedValue({
      data: [{ ...v2Pending, review_status: 'approved', review_reason: null }],
    });

    renderPage();

    expect(await screen.findByRole('link', { name: 'Confirmar publicacao' })).toBeInTheDocument();
  });

  it('shows an empty state when no draft has ever been submitted for this opportunity', async () => {
    (creatorPortalApi.listSubmissions as any).mockResolvedValue({ data: [] });

    renderPage();

    expect(
      await screen.findByText('Nenhum rascunho enviado ainda para esta oportunidade.'),
    ).toBeInTheDocument();
  });
});
