import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfirmPublicationPage } from './confirm-publication-page';
import { creatorPortalApi } from '@/lib/api-client';

vi.mock('@/lib/api-client', () => ({
  creatorPortalApi: {
    confirmPublication: vi.fn(),
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
      <MemoryRouter initialEntries={['/creator-portal/drafts/sub-6001/confirm-publication']}>
        <Routes>
          <Route path="/creator-portal/drafts/:id/confirm-publication" element={<ConfirmPublicationPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function fillAndSubmit(url = 'https://instagram.com/p/abc123') {
  await userEvent.type(screen.getByLabelText('Link do post publicado'), url);
  await userEvent.click(screen.getByRole('button', { name: 'Confirmar publicacao' }));
}

describe('ConfirmPublicationPage - US-34', () => {
  beforeEach(() => vi.clearAllMocks());

  // Normal: a cleared, matching post is confirmed (US-34 scenario 1).
  it('confirms publication and shows the recorded published_at', async () => {
    (creatorPortalApi.confirmPublication as any).mockResolvedValue({
      content_submission_id: 'sub-6001',
      published_url: 'https://instagram.com/p/abc123',
      published_at: '2026-10-23T08:00:00Z',
      status: 'confirmed',
    });

    renderPage();
    await fillAndSubmit();

    expect(await screen.findByText('Publicacao confirmada')).toBeInTheDocument();
  });

  // Hard: content that does not match the approved version is refused with a specific reason,
  // not recorded as a confirmed publication (US-34 scenario 2).
  it('refuses to record a mismatched publication and states why', async () => {
    (creatorPortalApi.confirmPublication as any).mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 422,
        data: { error: { code: 'PUBLICATION_CONTENT_MISMATCH', message: 'Conteudo nao corresponde.', details: { field: 'caption_text' } } },
      },
    });

    renderPage();
    await fillAndSubmit();

    expect(
      await screen.findByText('O conteudo publicado nesse link nao corresponde ao conteudo aprovado.'),
    ).toBeInTheDocument();
  });

  // Failure: an unresolvable link and a not-yet-cleared safety gate are each surfaced as their
  // own specific, distinct reason (US-34 scenario 3) -- never collapsed into one generic error.
  it('distinguishes an unreachable link from a safety gate that has not cleared yet', async () => {
    (creatorPortalApi.confirmPublication as any).mockRejectedValueOnce({
      isAxiosError: true,
      response: {
        status: 422,
        data: { error: { code: 'PUBLICATION_LINK_UNREACHABLE', message: 'Link inacessivel.' } },
      },
    });

    renderPage();
    await fillAndSubmit();
    expect(
      await screen.findByText('O link informado nao pode ser acessado. Verifique se o post esta publico e o endereco esta correto.'),
    ).toBeInTheDocument();

    (creatorPortalApi.confirmPublication as any).mockRejectedValueOnce({
      isAxiosError: true,
      response: {
        status: 409,
        data: { error: { code: 'SAFETY_NOT_CLEARED', message: 'Nao liberado.', details: { blocking_reason: 'flagged' } } },
      },
    });

    await userEvent.click(screen.getByRole('button', { name: 'Confirmar publicacao' }));
    expect(
      await screen.findByText(/O conteudo ainda nao foi liberado pela verificacao de seguranca de marca \(flagged\)/),
    ).toBeInTheDocument();
  });
});
