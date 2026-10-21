import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafetyRulesetPage } from './safety-ruleset-page';
import { safetyRulesetApi } from '@/lib/api-client';

vi.mock('@/lib/api-client', () => ({
  safetyRulesetApi: {
    getBrand: vi.fn(),
    createBrandRule: vi.fn(),
    updateBrandRule: vi.fn(),
    deleteBrandRule: vi.fn(),
  },
}));

vi.mock('@/contexts/auth-context', () => ({
  useAuth: () => ({ currentRole: 'brand_manager' }),
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/app/safety/ruleset']}>
        <SafetyRulesetPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const existingRuleset = {
  id: 'rs-brand-001',
  scope: 'brand',
  rules: [
    {
      id: 'rule-001',
      rule_type: 'competitor_mention',
      definition: { competitor_name: 'Marca Rival Ltda', aliases: ['Rival'] },
      action: 'add',
      supersedes_rule_id: null,
      created_at: new Date().toISOString(),
    },
  ],
  updated_at: new Date().toISOString(),
};

describe('SafetyRulesetPage - US-15', () => {
  beforeEach(() => vi.clearAllMocks());

  // Normal: the brand ruleset is listed by rule type (US-15 scenario 1).
  it('lists the existing brand-level ruleset', async () => {
    (safetyRulesetApi.getBrand as any).mockResolvedValue(existingRuleset);

    renderPage();

    expect(await screen.findByText(/Marca Rival Ltda/)).toBeInTheDocument();
  });

  // Failure: a malformed restricted-language pattern is rejected with a stated reason, and the
  // previously valid ruleset (the competitor rule already saved) stays visible and untouched (US-15 scenario 3).
  it('rejects a malformed rule with a stated reason and leaves the existing valid ruleset in effect', async () => {
    (safetyRulesetApi.getBrand as any).mockResolvedValue(existingRuleset);
    (safetyRulesetApi.createBrandRule as any).mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 422,
        data: { error: { code: 'RULE_PATTERN_INVALID', message: 'Padrao de expressao regular invalido.' } },
      },
    });

    renderPage();
    await screen.findByText(/Marca Rival Ltda/);

    const addButtons = screen.getAllByRole('button', { name: 'Adicionar regra' });
    // The second card is restricted_language, per RULE_TYPES order.
    await userEvent.click(addButtons[1]);
    await userEvent.type(screen.getByLabelText('Padrao'), '(((invalid');
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar' }));

    expect(await screen.findByText('Padrao de expressao regular invalido.')).toBeInTheDocument();
    // The previously valid competitor-mention rule is untouched and still visible.
    expect(screen.getByText(/Marca Rival Ltda/)).toBeInTheDocument();
  });
});
