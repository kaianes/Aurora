import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ExclusionsPage } from './exclusions-page';
import { exclusionApi } from '@/lib/api-client';

vi.mock('@/lib/api-client', () => ({
  exclusionApi: {
    list: vi.fn(),
    create: vi.fn(),
    remove: vi.fn(),
  },
}));

vi.mock('@/contexts/auth-context', () => ({
  useAuth: () => ({ currentRole: 'brand_manager' }),
}));

function renderBrandPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/app/exclusions']}>
        <Routes>
          <Route path="/app/exclusions" element={<ExclusionsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ExclusionsPage - US-14', () => {
  beforeEach(() => vi.clearAllMocks());

  // Normal: brand-level exclusions are listed and the create form adds a new one (US-14 scenario 1).
  it('lists existing brand-level exclusions and submits a new creator exclusion', async () => {
    (exclusionApi.list as any).mockResolvedValue({
      data: [
        { id: 'excl-1', scope: 'brand', campaign_id: null, exclusion_type: 'creator', creator_id: 'creator-5555', competitor_name: null, created_at: new Date().toISOString() },
      ],
      pagination: { next_cursor: null, has_more: false },
    });
    (exclusionApi.create as any).mockResolvedValue({ applies_to: 'future_shortlist_generations_only' });

    renderBrandPage();

    expect(await screen.findByText('Criador creator-5555')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Adicionar exclusao' }));
    await userEvent.type(screen.getByLabelText('ID do criador'), 'creator-7777');
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar' }));

    await waitFor(() =>
      expect(exclusionApi.create).toHaveBeenCalledWith(
        expect.objectContaining({ scope: 'brand', exclusion_type: 'creator', creator_id: 'creator-7777' }),
      ),
    );
  });

  // Hard: campaign-level and brand-level exclusions both render together with no manual reconciliation needed (US-14 scenario 2).
  it('renders both brand-level and campaign-level exclusions together without requiring reconciliation', async () => {
    (exclusionApi.list as any).mockResolvedValue({
      data: [
        { id: 'excl-1', scope: 'brand', campaign_id: null, exclusion_type: 'creator', creator_id: 'creator-9', competitor_name: null, created_at: new Date().toISOString() },
        { id: 'excl-2', scope: 'campaign', campaign_id: 'camp-1', exclusion_type: 'creator', creator_id: 'creator-9', competitor_name: null, created_at: new Date().toISOString() },
      ],
      pagination: { next_cursor: null, has_more: false },
    });

    renderBrandPage();

    const entries = await screen.findAllByText('Criador creator-9');
    expect(entries).toHaveLength(2);
    expect(screen.getByText('Marca')).toBeInTheDocument();
    expect(screen.getByText('Campanha')).toBeInTheDocument();
  });

  // Failure/clarifying message: after creating an exclusion, the UI explicitly states existing approvals are unaffected (US-14 scenario 3).
  it('states explicitly that a new exclusion only applies to future shortlist generations', async () => {
    (exclusionApi.list as any).mockResolvedValue({ data: [], pagination: { next_cursor: null, has_more: false } });
    (exclusionApi.create as any).mockResolvedValue({ applies_to: 'future_shortlist_generations_only' });

    renderBrandPage();
    await screen.findByText(/Nenhuma exclusao cadastrada/);

    await userEvent.click(screen.getByRole('button', { name: 'Adicionar exclusao' }));
    await userEvent.type(screen.getByLabelText('ID do criador'), 'creator-1');
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/aprovacoes ja feitas nao sao afetadas/);
  });
});
