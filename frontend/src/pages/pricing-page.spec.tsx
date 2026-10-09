import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { PricingPage } from './pricing-page';

// Mock the api-client module
vi.mock('@/lib/api-client', () => ({
  pricingApi: {
    get: vi.fn(),
  },
}));

import { pricingApi } from '@/lib/api-client';

const MOCK_PRICING = {
  updated_at: '2026-09-01T00:00:00Z',
  plans: [
    {
      workspace_type: 'brand',
      name: 'Brand',
      platform_fee: { amount: '497.00', currency: 'BRL', interval: 'month' },
      commission: { rate: '0.15', description: '15% sobre o valor pago aos criadores' },
      features: ['1 workspace de marca', 'Ate 3 membros da equipe'],
    },
    {
      workspace_type: 'agency',
      name: 'Agencia',
      platform_fee: { amount: '1497.00', currency: 'BRL', interval: 'month' },
      commission: { rate: '0.12', description: '12% sobre o valor pago aos criadores' },
      features: ['1 workspace de agencia', 'Ate 10 contas de clientes'],
      client_account_limit: 10,
    },
  ],
};

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PricingPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PricingPage - US-02 Transparent Pricing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // US-02 Scenario 1 - Normal: pricing visible without login
  it('should display the complete fee model without requiring authentication', async () => {
    (pricingApi.get as any).mockResolvedValue(MOCK_PRICING);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Precos transparentes')).toBeInTheDocument();
    });

    // Should show price amount
    expect(screen.getByText(/497/)).toBeInTheDocument();
    // Should show commission
    expect(screen.getByText('15%')).toBeInTheDocument();
    // Should show features
    expect(screen.getByText('1 workspace de marca')).toBeInTheDocument();
  });

  // US-02 Scenario 2 - Hard: toggle between brand and agency workspace types
  it('should show both workspace types with distinct pricing when toggled', async () => {
    (pricingApi.get as any).mockResolvedValue(MOCK_PRICING);
    const user = userEvent.setup();

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Precos transparentes')).toBeInTheDocument();
    });

    // Brand is default - should show brand pricing
    expect(screen.getByText(/497/)).toBeInTheDocument();

    // Toggle to agency
    const agencyTab = screen.getByRole('tab', { name: /Agencia/i });
    await user.click(agencyTab);

    // Should now show agency pricing
    await waitFor(() => {
      expect(screen.getByText(/1\.497/)).toBeInTheDocument();
    });
    expect(screen.getByText('12%')).toBeInTheDocument();
  });

  // US-02 Scenario 3 - Failure: API unavailable shows fallback with retry
  it('should show cached/fallback pricing with retry button when API fails', async () => {
    (pricingApi.get as any).mockRejectedValue(new Error('Network Error'));

    renderPage();

    // Wait for loading to finish and fallback to render
    await waitFor(() => {
      expect(screen.getByText('Precos transparentes')).toBeInTheDocument();
    }, { timeout: 10000 });

    // Should show warning about cached data
    expect(screen.getByRole('alert')).toBeInTheDocument();

    // Should still show pricing from fallback
    expect(screen.getByText(/497/)).toBeInTheDocument();

    // Should have retry button
    expect(screen.getByText(/Tentar novamente/i)).toBeInTheDocument();
  });

  // Accessibility: tablist for workspace type toggle
  it('should have accessible tablist for workspace type selection', async () => {
    (pricingApi.get as any).mockResolvedValue(MOCK_PRICING);

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('tablist')).toBeInTheDocument();
    });

    const tabs = screen.getAllByRole('tab');
    expect(tabs.length).toBe(2);

    // Brand tab should be selected by default
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false');
  });
});
