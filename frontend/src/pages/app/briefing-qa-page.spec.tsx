import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BriefingQaPage } from './briefing-qa-page';
import { briefingApi } from '@/lib/api-client';

vi.mock('@/lib/api-client', () => ({
  briefingApi: {
    listQa: vi.fn(),
    getQaThread: vi.fn(),
    answerQa: vi.fn(),
  },
}));

vi.mock('@/contexts/auth-context', () => ({
  useAuth: () => ({ currentRole: 'brand_manager' }),
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/app/campaigns/camp-1/briefing/qa']}>
        <Routes>
          <Route path="/app/campaigns/:id/briefing/qa" element={<BriefingQaPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const threadList = [
  { thread_id: 'qa-thr-001', creator_id: 'creator-9001', creator_display_name: 'Duda Oliveira', message_count: 1, answered: false, last_message_at: '2026-10-21T09:00:00Z' },
  { thread_id: 'qa-thr-002', creator_id: 'creator-9002', creator_display_name: 'Rafa Souza', message_count: 2, answered: true, last_message_at: '2026-10-21T10:00:00Z' },
];

const threadOneDetail = {
  thread_id: 'qa-thr-001',
  creator_id: 'creator-9001',
  creator_display_name: 'Duda Oliveira',
  messages: [{ sender_type: 'creator' as const, body: 'O video precisa ter audio?', created_at: '2026-10-21T09:00:00Z' }],
  answered: false,
};

const threadTwoDetail = {
  thread_id: 'qa-thr-002',
  creator_id: 'creator-9002',
  creator_display_name: 'Rafa Souza',
  messages: [
    { sender_type: 'creator' as const, body: 'Posso postar no Stories tambem?', created_at: '2026-10-21T10:00:00Z' },
    { sender_type: 'brand' as const, body: 'Sim, pode.', created_at: '2026-10-21T10:30:00Z' },
  ],
  answered: true,
};

describe('BriefingQaPage - US-31', () => {
  beforeEach(() => vi.clearAllMocks());

  // Normal: Marina (or a teammate) sees the question and can answer it, and the answer becomes
  // visible on the same thread (US-31 scenario 1).
  it('shows a pending question and records the answer on the same thread', async () => {
    (briefingApi.listQa as any).mockResolvedValue({ data: [threadList[0]] });
    (briefingApi.getQaThread as any).mockResolvedValue(threadOneDetail);
    (briefingApi.answerQa as any).mockResolvedValue({
      thread_id: 'qa-thr-001',
      sender_type: 'brand',
      body: 'Funciona com legenda, audio e opcional.',
      created_at: '2026-10-21T09:30:00Z',
    });

    renderPage();
    await userEvent.click(await screen.findByText('Duda Oliveira'));

    expect(await screen.findByText('O video precisa ter audio?')).toBeInTheDocument();
    expect(screen.getByText('Aguardando resposta')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Responder'), 'Funciona com legenda, audio e opcional.');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar resposta' }));

    await waitFor(() =>
      expect(briefingApi.answerQa).toHaveBeenCalledWith('camp-1', 'qa-thr-001', {
        body: 'Funciona com legenda, audio e opcional.',
      }),
    );
  });

  // Hard: each creator's thread stays private -- selecting one creator's thread must never show
  // another creator's question or answer (US-31 scenario 2).
  it('never mixes one creator thread detail into another when switching selection', async () => {
    (briefingApi.listQa as any).mockResolvedValue({ data: threadList });
    (briefingApi.getQaThread as any).mockImplementation((_campaignId: string, threadId: string) =>
      Promise.resolve(threadId === 'qa-thr-001' ? threadOneDetail : threadTwoDetail),
    );

    renderPage();
    await screen.findByText('Duda Oliveira');

    await userEvent.click(screen.getByText('Duda Oliveira'));
    expect(await screen.findByText('O video precisa ter audio?')).toBeInTheDocument();
    expect(screen.queryByText('Posso postar no Stories tambem?')).not.toBeInTheDocument();

    await userEvent.click(screen.getByText('Rafa Souza'));
    expect(await screen.findByText('Posso postar no Stories tambem?')).toBeInTheDocument();
    expect(screen.queryByText('O video precisa ter audio?')).not.toBeInTheDocument();
  });

  // Failure: an unanswered question stays visibly recorded as asked and unanswered in the
  // brand-side list too, rather than disappearing (US-31 scenario 3).
  it('keeps an unanswered thread visibly marked as awaiting a response in the thread list', async () => {
    (briefingApi.listQa as any).mockResolvedValue({ data: [threadList[0]] });

    renderPage();

    expect(await screen.findByText('Duda Oliveira')).toBeInTheDocument();
    expect(screen.getByText('Aguardando resposta')).toBeInTheDocument();
  });
});
