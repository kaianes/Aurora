import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MediaKitPage } from './media-kit-page';

const navigateMock = vi.fn();

vi.mock('@/lib/api-client', () => ({
  creatorPortalApi: {
    requestMediaKit: vi.fn(),
    getMediaKit: vi.fn(),
  },
  getCreatorToken: vi.fn(() => 'fake-creator-token'),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

import { creatorPortalApi } from '@/lib/api-client';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <MediaKitPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('MediaKitPage - US-25 Automatic Media Kit', () => {
  beforeEach(() => vi.clearAllMocks());

  // Normal (scenario 1): a kit is generated from her real campaign history and audience
  // metrics, downloadable with no manual compilation on her part.
  it('generates a kit from her real campaign history and offers a download', async () => {
    (creatorPortalApi.requestMediaKit as any).mockResolvedValue({ export_id: 'mk-001', status: 'pending', poll_url: '/v1/creator-portal/media-kit/mk-001' });
    (creatorPortalApi.getMediaKit as any).mockResolvedValue({
      id: 'mk-001',
      status: 'ready',
      has_campaign_history: true,
      pdf_document_url: 'https://assets.aurora.com.br/media-kits/mk-001/kit.pdf',
    });

    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Gerar media kit' }));

    expect(await screen.findByText(/alem do seu historico de campanhas entregues/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Baixar PDF' })).toHaveAttribute(
      'href',
      'https://assets.aurora.com.br/media-kits/mk-001/kit.pdf',
    );
    // Never a fabricated campaign-performance section notice when she does have real history.
    expect(screen.queryByText(/sera preenchida apos sua primeira entrega/i)).not.toBeInTheDocument();
  });

  // Hard (scenario 2): no completed campaigns yet -- the kit still generates using real
  // audience metrics, with the campaign-performance section clearly separated and never
  // fabricated.
  it('still generates a kit with no campaign history yet, clearly separating that section rather than fabricating it', async () => {
    (creatorPortalApi.requestMediaKit as any).mockResolvedValue({ export_id: 'mk-002', status: 'pending', poll_url: '/v1/creator-portal/media-kit/mk-002' });
    (creatorPortalApi.getMediaKit as any).mockResolvedValue({
      id: 'mk-002',
      status: 'ready',
      has_campaign_history: false,
      campaign_section_message: 'Esta secao sera preenchida apos sua primeira entrega de campanha.',
      pdf_document_url: 'https://assets.aurora.com.br/media-kits/mk-002/kit.pdf',
    });

    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Gerar media kit' }));

    expect(await screen.findByText('Esta secao sera preenchida apos sua primeira entrega de campanha.')).toBeInTheDocument();
    // The kit is still generated and downloadable -- never a dead end just because she has
    // no campaign history.
    expect(screen.getByRole('link', { name: 'Baixar PDF' })).toBeInTheDocument();
  });

  // While the export is still being generated, she sees a generating indicator, not a
  // blank or broken page.
  it('shows a generating indicator while the export is pending', async () => {
    (creatorPortalApi.requestMediaKit as any).mockResolvedValue({ export_id: 'mk-003', status: 'pending', poll_url: '/v1/creator-portal/media-kit/mk-003' });
    (creatorPortalApi.getMediaKit as any).mockResolvedValue({ id: 'mk-003', status: 'pending' });

    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Gerar media kit' }));

    expect(await screen.findByText(/Gerando seu media kit/i)).toBeInTheDocument();
  });

  // Failure (scenario 3): generation fails -- she is told explicitly and offered a retry,
  // never a blank or partially rendered document.
  it('tells her generation failed and offers a retry, never a blank document', async () => {
    (creatorPortalApi.requestMediaKit as any).mockResolvedValue({ export_id: 'mk-003', status: 'pending', poll_url: '/v1/creator-portal/media-kit/mk-003' });
    (creatorPortalApi.getMediaKit as any).mockResolvedValue({
      id: 'mk-003',
      status: 'failed',
      failure_reason: 'render_error',
      message: 'Nao foi possivel gerar seu media kit. Tente novamente.',
    });

    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Gerar media kit' }));

    expect(await screen.findByText('Nao foi possivel gerar seu media kit. Tente novamente.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Baixar PDF' })).not.toBeInTheDocument();
  });

  // Failure: the initial request itself fails (never even reaches pending) -- surfaced
  // clearly, not silently.
  it('shows an error message when the initial media kit request itself fails', async () => {
    (creatorPortalApi.requestMediaKit as any).mockRejectedValue({
      isAxiosError: true,
      response: { data: { error: { code: 'INTERNAL_ERROR', message: 'Nao foi possivel solicitar seu media kit agora.' } } },
    });

    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Gerar media kit' }));

    expect(await screen.findByText('Nao foi possivel solicitar seu media kit agora.')).toBeInTheDocument();
  });

  it('redirects to login when there is no creator session', async () => {
    const apiClient = await import('@/lib/api-client');
    (apiClient.getCreatorToken as any).mockReturnValueOnce(null);

    renderPage();

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/creator-portal/login'));
  });
});
