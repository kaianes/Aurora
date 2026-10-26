import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RatePreferencesPage } from './rate-preferences-page';

const navigateMock = vi.fn();

vi.mock('@/lib/api-client', () => ({
  creatorPortalApi: {
    listRatePreferences: vi.fn(),
    setRatePreference: vi.fn(),
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
        <RatePreferencesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RatePreferencesPage - US-27 Creator-Set Rate Preferences', () => {
  beforeEach(() => vi.clearAllMocks());

  // Normal (scenario 1): she sets a rate for a specific deliverable format, and it is
  // stored and displayed on her profile, explicitly flagged as applying going forward.
  it('sets a rate for a deliverable format and shows it stored, applying going forward', async () => {
    (creatorPortalApi.listRatePreferences as any).mockResolvedValue({ data: [] });
    (creatorPortalApi.setRatePreference as any).mockResolvedValue({
      deliverable_format: 'instagram_reel',
      rate_amount: '350.00',
      currency: 'BRL',
      updated_at: '2026-10-21T11:00:00Z',
      applies_to: 'future_opportunities_only',
    });

    const user = userEvent.setup();
    renderPage();

    await screen.findByText(/ainda nao definiu nenhum valor/i);
    await user.selectOptions(screen.getByLabelText(/Formato/i), 'instagram_reel');
    await user.type(screen.getByLabelText(/Valor \(BRL\)/i), '350.00');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => {
      expect(creatorPortalApi.setRatePreference).toHaveBeenCalledWith('instagram_reel', {
        rate_amount: '350.00',
        currency: 'BRL',
      });
    });
    expect(await screen.findByText(/Valor salvo para Instagram Reel/i)).toBeInTheDocument();
    expect(screen.getByText(/Vale a partir de agora, para novas oportunidades/i)).toBeInTheDocument();
  });

  // Hard (scenario 2): updating her rate is explicitly described as applying only to future
  // opportunities -- she is told this, not left to assume it is retroactive.
  it('tells her an existing rate applies only to future opportunities, never retroactively', async () => {
    (creatorPortalApi.listRatePreferences as any).mockResolvedValue({
      data: [
        { deliverable_format: 'instagram_reel', rate_amount: '300.00', currency: 'BRL', updated_at: '2026-09-01T00:00:00Z' },
      ],
    });

    renderPage();

    expect(await screen.findByText(/qualquer oportunidade ja criada mantem o valor original/i)).toBeInTheDocument();
    // Wait for her existing rate row itself to finish loading before checking its own copy.
    expect(await screen.findByText(/Atualizado em/i)).toBeInTheDocument();
    // Both the page-level explanation and the per-rate row itself say so -- never left implicit.
    expect(screen.getAllByText(/vale apenas para novas oportunidades/i).length).toBeGreaterThanOrEqual(2);
  });

  // Failure (scenario 3): client-side bounds (ADR-0058: > 0 and <= 50000) reject an invalid
  // rate before it ever reaches the API -- it is never silently clamped or rounded.
  it.each([
    ['0', 'maior que zero'],
    ['-10', 'maior que zero'],
    ['50001', 'maximo permitido'],
  ])('rejects an out-of-bounds rate (%s) with a clear reason, never submitting it', async (value, expectedMessage) => {
    (creatorPortalApi.listRatePreferences as any).mockResolvedValue({ data: [] });
    const user = userEvent.setup();
    renderPage();

    await screen.findByText(/ainda nao definiu nenhum valor/i);
    await user.selectOptions(screen.getByLabelText(/Formato/i), 'instagram_reel');
    await user.type(screen.getByLabelText(/Valor \(BRL\)/i), value);
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => {
      expect(screen.getByText(new RegExp(expectedMessage, 'i'))).toBeInTheDocument();
    });
    expect(creatorPortalApi.setRatePreference).not.toHaveBeenCalled();
  });

  // Failure, server-rejection half: even if a value slips past client validation, the
  // backend's own INVALID_RATE rejection (the database-enforced bound, ADR-0058) is
  // surfaced with its own clear message, never silently accepted.
  it('shows a clear rejection message if the server itself rejects the rate as invalid', async () => {
    (creatorPortalApi.listRatePreferences as any).mockResolvedValue({ data: [] });
    (creatorPortalApi.setRatePreference as any).mockRejectedValue({
      isAxiosError: true,
      response: {
        data: {
          error: {
            code: 'INVALID_RATE',
            message: 'O valor deve ser maior que zero e no maximo 50000.',
            details: { min: 0, max: 50000 },
          },
        },
      },
    });

    const user = userEvent.setup();
    renderPage();

    await screen.findByText(/ainda nao definiu nenhum valor/i);
    await user.selectOptions(screen.getByLabelText(/Formato/i), 'instagram_reel');
    await user.type(screen.getByLabelText(/Valor \(BRL\)/i), '40000');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(await screen.findByText('O valor deve ser maior que zero e no maximo 50000.')).toBeInTheDocument();
  });

  it('requires a format to be selected before submitting', async () => {
    (creatorPortalApi.listRatePreferences as any).mockResolvedValue({ data: [] });
    const user = userEvent.setup();
    renderPage();

    await screen.findByText(/ainda nao definiu nenhum valor/i);
    await user.type(screen.getByLabelText(/Valor \(BRL\)/i), '350');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    // The placeholder option itself also reads "Selecione um formato" -- scope to the
    // rendered validation alert specifically, not just any matching text on the page.
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Selecione um formato'));
    expect(creatorPortalApi.setRatePreference).not.toHaveBeenCalled();
  });

  it('redirects to login when there is no creator session', async () => {
    const apiClient = await import('@/lib/api-client');
    (apiClient.getCreatorToken as any).mockReturnValueOnce(null);
    (creatorPortalApi.listRatePreferences as any).mockResolvedValue({ data: [] });

    renderPage();

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/creator-portal/login'));
  });
});
