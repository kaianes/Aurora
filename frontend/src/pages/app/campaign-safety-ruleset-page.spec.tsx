import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CampaignSafetyRulesetPage } from './campaign-safety-ruleset-page';
import { safetyRulesetApi } from '@/lib/api-client';

vi.mock('@/lib/api-client', () => ({
  safetyRulesetApi: {
    getCampaignRuleset: vi.fn(),
    getBrand: vi.fn(),
    createCampaignOverride: vi.fn(),
    deleteCampaignOverride: vi.fn(),
  },
}));

vi.mock('@/contexts/auth-context', () => ({
  useAuth: () => ({ currentRole: 'brand_manager' }),
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/app/campaigns/camp-1234/safety-ruleset']}>
        <Routes>
          <Route path="/app/campaigns/:id/safety-ruleset" element={<CampaignSafetyRulesetPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CampaignSafetyRulesetPage - US-15 scenario 2', () => {
  beforeEach(() => vi.clearAllMocks());

  // Hard: a campaign running on an override must make that explicit, distinct from the inherited default.
  it('makes clear the campaign is running on an override rather than the inherited brand default', async () => {
    (safetyRulesetApi.getCampaignRuleset as any).mockResolvedValue({
      campaign_id: 'camp-1234',
      has_override: true,
      effective_rules: [
        {
          id: 'rule-001',
          rule_type: 'competitor_mention',
          definition: { competitor_name: 'Marca Rival S.A.' },
          source: 'brand',
        },
        {
          id: 'rule-override-010',
          rule_type: 'competitor_mention',
          definition: null,
          source: 'campaign_override',
          override_action: 'suppress',
          supersedes_rule_id: 'rule-003',
          note: 'Regra de marca concorrente suspensa apenas para esta campanha',
        },
      ],
      override_rule_ids: ['rule-override-010'],
    });
    (safetyRulesetApi.getBrand as any).mockResolvedValue({ id: 'rs-brand-001', scope: 'brand', rules: [], updated_at: new Date().toISOString() });

    renderPage();

    expect(await screen.findByText(/esta rodando com um override de seguranca/)).toBeInTheDocument();
    expect(screen.getByText('Padrao da marca')).toBeInTheDocument();
    expect(screen.getByText('Suspende a regra da marca')).toBeInTheDocument();
  });

  // Normal: a campaign with no override at all states it is simply on the inherited default.
  it('states the campaign uses the inherited brand default when there is no override', async () => {
    (safetyRulesetApi.getCampaignRuleset as any).mockResolvedValue({
      campaign_id: 'camp-5678',
      has_override: false,
      effective_rules: [],
      override_rule_ids: [],
    });
    (safetyRulesetApi.getBrand as any).mockResolvedValue({ id: 'rs-brand-001', scope: 'brand', rules: [], updated_at: new Date().toISOString() });

    renderPage();

    expect(await screen.findByText(/usa o padrao de seguranca herdado da marca, sem overrides/)).toBeInTheDocument();
  });
});
