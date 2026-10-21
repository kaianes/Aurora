import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CreatorBriefingQaPage } from './briefing-qa-page';
import { creatorPortalApi } from '@/lib/api-client';

vi.mock('@/lib/api-client', () => ({
  creatorPortalApi: {
    getBriefingQa: vi.fn(),
    askBriefingQuestion: vi.fn(),
  },
  getCreatorToken: vi.fn(() => 'fake-creator-token'),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});

function renderPage(search = '?campaign_id=camp-1234') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/creator-portal/briefing/qa${search}`]}>
        <CreatorBriefingQaPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CreatorBriefingQaPage - US-31', () => {
  beforeEach(() => vi.clearAllMocks());

  // Normal: Duda asks a question, and once answered, she sees the answer on the same thread
  // (US-31 scenario 1).
  it('shows the answer once the brand side has responded, on the same thread', async () => {
    (creatorPortalApi.getBriefingQa as any).mockResolvedValue({
      thread_id: 'qa-thr-001',
      messages: [
        { sender_type: 'creator', body: 'O video precisa ter audio?', created_at: '2026-10-21T09:00:00Z' },
        { sender_type: 'brand', body: 'Funciona com legenda tambem.', created_at: '2026-10-21T09:30:00Z' },
      ],
      answered: true,
    });

    renderPage();

    expect(await screen.findByText('O video precisa ter audio?')).toBeInTheDocument();
    expect(screen.getByText('Funciona com legenda tambem.')).toBeInTheDocument();
    expect(screen.queryByText('Aguardando resposta')).not.toBeInTheDocument();
  });

  // Failure: a question that nobody has answered yet stays visibly recorded as asked and
  // unanswered, never disappearing (US-31 scenario 3).
  it('keeps an unanswered question visibly recorded rather than disappearing', async () => {
    (creatorPortalApi.getBriefingQa as any).mockResolvedValue({
      thread_id: 'qa-thr-001',
      messages: [{ sender_type: 'creator', body: 'O video precisa ter audio?', created_at: '2026-10-21T09:00:00Z' }],
      answered: false,
    });

    renderPage();

    expect(await screen.findByText('O video precisa ter audio?')).toBeInTheDocument();
    expect(screen.getByText('Aguardando resposta')).toBeInTheDocument();
  });

  // Normal (first question): asking a question submits it and the thread is re-fetched to
  // reflect what the backend actually recorded.
  it('submits a new question and refetches the thread afterward', async () => {
    (creatorPortalApi.getBriefingQa as any)
      .mockResolvedValueOnce({ thread_id: null, messages: [], answered: null })
      .mockResolvedValueOnce({
        thread_id: 'qa-thr-001',
        messages: [{ sender_type: 'creator', body: 'Posso usar musica de fundo?', created_at: '2026-10-21T09:00:00Z' }],
        answered: false,
      });
    (creatorPortalApi.askBriefingQuestion as any).mockResolvedValue({
      thread_id: 'qa-thr-001',
      sender_type: 'creator',
      body: 'Posso usar musica de fundo?',
      created_at: '2026-10-21T09:00:00Z',
    });

    renderPage();
    await screen.findByText('Fazer uma pergunta');

    await userEvent.type(screen.getByLabelText('Sua pergunta'), 'Posso usar musica de fundo?');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar pergunta' }));

    await waitFor(() =>
      expect(creatorPortalApi.askBriefingQuestion).toHaveBeenCalledWith({
        campaign_id: 'camp-1234',
        question: 'Posso usar musica de fundo?',
      }),
    );
    expect(await screen.findByText('Posso usar musica de fundo?')).toBeInTheDocument();
  });
});
