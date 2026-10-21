import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NewSubmissionPage } from './new-submission-page';
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
      <MemoryRouter initialEntries={['/creator-portal/submissions/new']}>
        <NewSubmissionPage />
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
  await userEvent.click(screen.getByRole('button', { name: 'Enviar para verificacao' }));
}

describe('NewSubmissionPage - US-16', () => {
  beforeEach(() => vi.clearAllMocks());

  // Normal: a compliant submission passes and clears for publication, with the tier the verdict
  // resolved at surfaced (US-16 scenario 1).
  it('shows a pass verdict once the check resolves as passed', async () => {
    (creatorPortalApi.listOpportunities as any).mockResolvedValue({ data: [acceptedOpportunity] });
    (creatorPortalApi.submitContent as any).mockResolvedValue({
      content_submission_id: 'sub-5001',
      safety_check_id: 'chk-9001',
      status: 'pending',
      poll_url: '/v1/safety/submissions/sub-5001/check',
    });
    (creatorPortalApi.getSafetyCheck as any).mockResolvedValue({
      id: 'chk-9001',
      status: 'passed',
      tier_reached: 'tier1',
      requested_at: new Date().toISOString(),
      resolved_at: new Date().toISOString(),
    });

    renderPage();
    await fillAndSubmit();

    expect(
      await screen.findByText(/passou na verificacao de seguranca de marca e pode avancar/),
    ).toBeInTheDocument();
  });

  // Hard: a violation surfaces in only one of the three checked channels (here, audio) while the
  // caption is clean. The flagged outcome must cite the specific channel and rule, and a pass in
  // the other channels never produces an overall pass (US-16 scenario 2).
  it('flags the submission citing the specific channel and rule, even though the caption alone was clean', async () => {
    (creatorPortalApi.listOpportunities as any).mockResolvedValue({ data: [acceptedOpportunity] });
    (creatorPortalApi.submitContent as any).mockResolvedValue({
      content_submission_id: 'sub-5001',
      safety_check_id: 'chk-9001',
      status: 'pending',
      poll_url: '/v1/safety/submissions/sub-5001/check',
    });
    (creatorPortalApi.getSafetyCheck as any).mockResolvedValue({
      id: 'chk-9001',
      status: 'flagged',
      tier_reached: 'tier2',
      triggered_rules: [
        {
          rule_id: 'rule-007',
          rule_type: 'restricted_language',
          channel: 'audio',
          matched_excerpt: 'resultado garantido em uma semana',
        },
      ],
      requested_at: new Date().toISOString(),
      resolved_at: new Date().toISOString(),
    });

    renderPage();
    await fillAndSubmit();

    expect(
      await screen.findByText(/nao passou na verificacao de seguranca de marca e nao pode ser publicada/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Audio/)).toBeInTheDocument();
    expect(screen.getByText(/restricted_language/)).toBeInTheDocument();
    expect(screen.getByText(/resultado garantido em uma semana/)).toBeInTheDocument();
  });

  // ADR-0022's check_unavailable state must still be rendered honestly here, distinct from a
  // rule-triggered flag, since the component is the one place the creator sees it.
  it('shows an honest message, not a fake rule citation, when the check cannot complete in time', async () => {
    (creatorPortalApi.listOpportunities as any).mockResolvedValue({ data: [acceptedOpportunity] });
    (creatorPortalApi.submitContent as any).mockResolvedValue({
      content_submission_id: 'sub-5001',
      safety_check_id: 'chk-9001',
      status: 'pending',
      poll_url: '/v1/safety/submissions/sub-5001/check',
    });
    (creatorPortalApi.getSafetyCheck as any).mockResolvedValue({
      id: 'chk-9001',
      status: 'check_unavailable',
      message:
        'A verificacao de seguranca da marca nao pode ser concluida a tempo. O conteudo permanece bloqueado para publicacao e foi enviado para revisao humana.',
      requested_at: new Date().toISOString(),
      resolved_at: new Date().toISOString(),
    });

    renderPage();
    await fillAndSubmit();

    expect(await screen.findByText(/nao pode ser concluida a tempo/)).toBeInTheDocument();
    expect(screen.queryByText(/Regras acionadas/)).not.toBeInTheDocument();
  });

  // Submission intake itself can fail (e.g. no accepted opportunity found) -- this must be a
  // stated, explicit error rather than a silent no-op.
  it('shows an explicit error when the intake request itself is rejected', async () => {
    (creatorPortalApi.listOpportunities as any).mockResolvedValue({ data: [acceptedOpportunity] });
    (creatorPortalApi.submitContent as any).mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 404,
        data: { error: { code: 'OPPORTUNITY_NOT_FOUND', message: 'Nenhuma oportunidade aceita foi encontrada.' } },
      },
    });

    renderPage();
    await fillAndSubmit();

    await waitFor(() =>
      expect(screen.getByText('Nenhuma oportunidade aceita foi encontrada.')).toBeInTheDocument(),
    );
  });
});
