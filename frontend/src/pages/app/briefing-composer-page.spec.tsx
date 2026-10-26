import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BriefingComposerPage } from './briefing-composer-page';
import { briefingApi } from '@/lib/api-client';

vi.mock('@/lib/api-client', () => ({
  briefingApi: {
    get: vi.fn(),
    save: vi.fn(),
    issue: vi.fn(),
  },
}));

vi.mock('@/contexts/auth-context', () => ({
  useAuth: () => ({ currentRole: 'brand_manager' }),
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/app/campaigns/camp-1/briefing']}>
        <Routes>
          <Route path="/app/campaigns/:id/briefing" element={<BriefingComposerPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const draftBriefing = {
  id: 'brf-001',
  campaign_id: 'camp-1',
  status: 'draft' as const,
  dos: null,
  donts: null,
  reference_examples: null,
  deliverable_spec: null,
  deadline: null,
  issued_at: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

describe('BriefingComposerPage - US-18a', () => {
  beforeEach(() => vi.clearAllMocks());

  // Hard: partial save with required fields still empty is allowed, and the briefing stays
  // marked as a draft (US-18a scenario 2).
  it('allows a partial save while required fields are still empty', async () => {
    (briefingApi.get as any).mockResolvedValue(draftBriefing);
    (briefingApi.save as any).mockResolvedValue({ ...draftBriefing, dos: ['Mostrar o produto'] });

    renderPage();
    await screen.findByText('Rascunho');

    await userEvent.type(screen.getByLabelText("Do's (um por linha)"), 'Mostrar o produto');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar rascunho' }));

    await waitFor(() => expect(briefingApi.save).toHaveBeenCalled());
    expect(await screen.findByText('Progresso salvo.')).toBeInTheDocument();
  });

  // Failure: issuing with required fields empty is refused, names exactly which fields are
  // missing, and sends nothing (US-18a scenario 3). The missing-field errors must be
  // programmatically associated with their fields (NFR-26 / WCAG 3.3.1), not conveyed by color
  // alone -- this assertion checks the field-level error text is rendered, not just the summary.
  it('refuses to issue an incomplete briefing and states exactly which fields are missing', async () => {
    (briefingApi.get as any).mockResolvedValue(draftBriefing);
    (briefingApi.save as any).mockResolvedValue(draftBriefing);
    (briefingApi.issue as any).mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 422,
        data: {
          error: {
            code: 'BRIEFING_INCOMPLETE',
            message: 'O briefing nao pode ser emitido: os seguintes campos estao vazios.',
            details: { missing_fields: ['reference_examples', 'deadline'] },
          },
        },
      },
    });

    renderPage();
    await screen.findByText('Rascunho');

    await userEvent.click(screen.getByRole('button', { name: 'Emitir briefing para o pool' }));

    const summaryAlert = (await screen.findByText('O briefing nao pode ser emitido: os seguintes campos estao vazios.')).closest(
      '[role="alert"]',
    ) as HTMLElement;
    expect(within(summaryAlert).getByText('Exemplos de referencia')).toBeInTheDocument();
    expect(within(summaryAlert).getByText('Prazo')).toBeInTheDocument();
    // Field-level error, programmatically associated via aria-describedby on the textarea/input.
    expect(
      screen.getByText('Obrigatorio para emitir o briefing: adicione ao menos um exemplo (link, descricao ou qualquer texto nao vazio).'),
    ).toBeInTheDocument();
  });

  // Normal: a complete briefing issues successfully, reaching the whole pool in one action
  // (US-18a scenario 1, US-18b scenario 1), and the briefing becomes immutable once issued.
  it('issues successfully and reports how many creators were queued', async () => {
    const completeBriefing = {
      ...draftBriefing,
      dos: ['Mostrar o produto'],
      donts: ['Nao mencionar concorrentes'],
      reference_examples: ['https://instagram.com/p/exemplo123'],
      deliverable_spec: { format: 'instagram_reel' },
      deadline: '2026-11-05T23:59:59Z',
    };
    (briefingApi.get as any).mockResolvedValue(completeBriefing);
    (briefingApi.save as any).mockResolvedValue(completeBriefing);
    (briefingApi.issue as any).mockResolvedValue({
      id: 'brf-001',
      status: 'issued',
      issued_at: new Date().toISOString(),
      recipients_queued: 42,
    });

    renderPage();
    await screen.findByText('Rascunho');

    await userEvent.click(screen.getByRole('button', { name: 'Emitir briefing para o pool' }));

    expect(await screen.findByText(/42 criadores foram colocados na fila de distribuicao/)).toBeInTheDocument();
  });
});
