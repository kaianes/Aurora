import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NewDraftPage } from './new-draft-page';
import { creatorPortalApi } from '@/lib/api-client';

vi.mock('@/lib/api-client', () => ({
  creatorPortalApi: {
    listOpportunities: vi.fn(),
    submitContent: vi.fn(),
    getSafetyCheck: vi.fn(),
  },
  getCreatorToken: vi.fn(() => 'fake-creator-token'),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/creator-portal/drafts/new']}>
        <NewDraftPage />
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

async function fillAndSubmit(caption = 'Esse serum mudou minha pele em 14 dias!') {
  await screen.findByText('Acme Cosmeticos · instagram_reel');
  await userEvent.selectOptions(screen.getByLabelText('Oportunidade'), 'opp-1');
  await userEvent.type(screen.getByLabelText('Legenda (obrigatorio)'), caption);
  await userEvent.click(screen.getByRole('button', { name: 'Enviar rascunho' }));
}

describe('NewDraftPage - US-32a, US-32b', () => {
  beforeEach(() => vi.clearAllMocks());

  // Normal: a first draft is accepted and the stated review deadline shows immediately
  // (US-32a scenario 1, US-32b scenario 1).
  it('shows the version number and review deadline immediately on a successful submission', async () => {
    (creatorPortalApi.listOpportunities as any).mockResolvedValue({ data: [acceptedOpportunity] });
    (creatorPortalApi.submitContent as any).mockResolvedValue({
      content_submission_id: 'sub-6001',
      version_number: 1,
      safety_check_id: 'chk-9050',
      status: 'pending',
      review_deadline_at: '2026-10-23T09:00:00Z',
      poll_url: '/v1/safety/submissions/sub-6001/check',
    });
    (creatorPortalApi.getSafetyCheck as any).mockResolvedValue({
      id: 'chk-9050',
      status: 'passed',
      requested_at: new Date().toISOString(),
      resolved_at: new Date().toISOString(),
    });

    renderPage();
    await fillAndSubmit();

    expect(await screen.findByText('Versao: 1')).toBeInTheDocument();
    expect(screen.getByText(/Prazo de revisao:/)).toBeInTheDocument();
  });

  // Failure: a resubmission attempted while the latest version is still pending review is
  // refused with a specific, named reason (ADR-0025's resubmission precondition).
  it('shows a specific message when a resubmission is attempted while the latest version is still pending', async () => {
    (creatorPortalApi.listOpportunities as any).mockResolvedValue({ data: [acceptedOpportunity] });
    (creatorPortalApi.submitContent as any).mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 409,
        data: { error: { code: 'PENDING_REVIEW_IN_PROGRESS', message: 'Existe uma versao pendente.' } },
      },
    });

    renderPage();
    await fillAndSubmit();

    expect(
      await screen.findByText(
        'A versao mais recente deste envio ainda esta aguardando revisao. Aguarde a decisao antes de enviar outra.',
      ),
    ).toBeInTheDocument();
  });

  // Failure: submitting against an opportunity that is not accepted states why, rather than
  // silently creating a misleading record (US-32a scenario 3).
  it('shows a specific message when there is no accepted opportunity behind the submission', async () => {
    (creatorPortalApi.listOpportunities as any).mockResolvedValue({ data: [acceptedOpportunity] });
    (creatorPortalApi.submitContent as any).mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 404,
        data: { error: { code: 'OPPORTUNITY_NOT_FOUND', message: 'Oportunidade nao encontrada.' } },
      },
    });

    renderPage();
    await fillAndSubmit();

    await waitFor(() =>
      expect(
        screen.getByText('Nenhuma oportunidade aceita foi encontrada para este envio.'),
      ).toBeInTheDocument(),
    );
  });
});
