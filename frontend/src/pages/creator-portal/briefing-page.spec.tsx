import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CreatorBriefingPage } from './briefing-page';
import { creatorPortalApi } from '@/lib/api-client';

vi.mock('@/lib/api-client', () => ({
  creatorPortalApi: {
    getBriefing: vi.fn(),
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
      <MemoryRouter initialEntries={[`/creator-portal/briefing${search}`]}>
        <CreatorBriefingPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CreatorBriefingPage - US-30', () => {
  beforeEach(() => vi.clearAllMocks());

  // Normal: every required field renders explicitly, nothing left to infer (US-30 scenario 1),
  // and a deliverable-specific detail (an aspect ratio) is shown as part of the spec itself
  // rather than buried in general notes (US-30 scenario 2).
  it('renders dos, donts, examples, and a deliverable-specific detail explicitly', async () => {
    (creatorPortalApi.getBriefing as any).mockResolvedValue({
      id: 'brf-001',
      campaign_id: 'camp-1234',
      status: 'issued',
      dos: ['Mostrar o produto sendo aplicado'],
      donts: ['Nao mencionar concorrentes'],
      reference_examples: ['https://instagram.com/p/exemplo123'],
      deliverable_spec: { format: 'instagram_reel', aspect_ratio: '9:16', caption_length_limit: 150 },
      deadline: '2026-11-05T23:59:59Z',
      issued_at: '2026-10-20T11:00:00Z',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    renderPage();

    expect(await screen.findByText('Mostrar o produto sendo aplicado')).toBeInTheDocument();
    expect(screen.getByText('Nao mencionar concorrentes')).toBeInTheDocument();
    expect(screen.getByText('https://instagram.com/p/exemplo123')).toBeInTheDocument();
    expect(screen.getByText('9:16')).toBeInTheDocument();
    expect(screen.getByText('150')).toBeInTheDocument();
  });

  // Failure: no active opportunity means no briefing content is shown, with a clear explicit
  // message, never exposing private brand content without an active relationship (US-30 scenario 3).
  it('shows a clear unavailable message and no briefing content when there is no active opportunity', async () => {
    (creatorPortalApi.getBriefing as any).mockResolvedValue(null);

    renderPage();

    expect(
      await screen.findByText(/Nenhum briefing disponivel para voce nesta campanha/),
    ).toBeInTheDocument();
    expect(screen.queryByText('O que fazer')).not.toBeInTheDocument();
  });
});
