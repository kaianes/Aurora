import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { pricingApi } from '@/lib/api-client';
import type { PricingResponse } from '@/types/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { Alert } from '@/components/ui/alert';

// Static fallback pricing for when the API is unavailable (US-02 scenario 3)
const FALLBACK_PRICING: PricingResponse = {
  updated_at: '2026-09-01T00:00:00Z',
  plans: [
    {
      workspace_type: 'brand',
      name: 'Brand',
      platform_fee: { amount: '497.00', currency: 'BRL', interval: 'month' },
      commission: { rate: '0.15', description: '15% sobre o valor pago aos criadores' },
      features: [
        '1 workspace de marca',
        'Ate 3 membros da equipe',
        'Perfil de marca completo',
        'Campanhas ilimitadas',
      ],
    },
    {
      workspace_type: 'agency',
      name: 'Agencia',
      platform_fee: { amount: '1497.00', currency: 'BRL', interval: 'month' },
      commission: { rate: '0.12', description: '12% sobre o valor pago aos criadores' },
      features: [
        '1 workspace de agencia',
        'Ate 10 contas de clientes',
        'Ate 10 membros da equipe',
        'Templates reutilizaveis entre clientes',
      ],
      client_account_limit: 10,
    },
  ],
};

export function PricingPage() {
  const [selectedType, setSelectedType] = useState<'brand' | 'agency'>('brand');

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['pricing'],
    queryFn: pricingApi.get,
    staleTime: 60 * 60 * 1000, // 1 hour
    retry: 2,
  });

  const pricing = data ?? (isError ? FALLBACK_PRICING : null);
  const plans = pricing?.plans ?? [];
  const selectedPlan = plans.find((p) => p.workspace_type === selectedType);

  if (isLoading) {
    return <Spinner />;
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:py-16">
      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold text-text-dark sm:text-4xl">Precos transparentes</h1>
        <p className="mt-3 text-lg text-muted">
          Sem cotacoes, sem vendas. Veja o modelo completo de precos antes de se comprometer.
        </p>
      </div>

      {isError && (
        <Alert variant="warning" className="mb-6">
          Exibindo precos em cache. Os valores podem estar desatualizados.{' '}
          <button onClick={() => refetch()} className="underline font-medium">
            Tentar novamente
          </button>
        </Alert>
      )}

      {/* Toggle */}
      <div className="flex justify-center mb-8">
        <div className="inline-flex rounded-lg border border-border overflow-hidden" role="tablist" aria-label="Tipo de plano">
          <button
            role="tab"
            aria-selected={selectedType === 'brand'}
            onClick={() => setSelectedType('brand')}
            className={`px-6 py-2.5 text-sm font-medium transition-colors ${
              selectedType === 'brand' ? 'bg-primary text-white' : 'bg-white text-muted hover:bg-surface'
            }`}
          >
            Marca
          </button>
          <button
            role="tab"
            aria-selected={selectedType === 'agency'}
            onClick={() => setSelectedType('agency')}
            className={`px-6 py-2.5 text-sm font-medium transition-colors ${
              selectedType === 'agency' ? 'bg-primary text-white' : 'bg-white text-muted hover:bg-surface'
            }`}
          >
            Agencia
          </button>
        </div>
      </div>

      {/* Plan card */}
      {selectedPlan && (
        <Card className="mx-auto max-w-lg">
          <div className="text-center mb-6">
            <h2 className="text-2xl font-bold text-text-dark">{selectedPlan.name}</h2>
            <div className="mt-4">
              <span className="text-4xl font-bold font-mono text-primary">
                R$ {parseFloat(selectedPlan.platform_fee.amount).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </span>
              <span className="text-muted text-sm"> /mes</span>
            </div>
          </div>

          {/* Commission */}
          <div className="rounded-lg bg-surface p-4 mb-6">
            <p className="text-sm font-medium text-text-dark mb-1">Comissao</p>
            <p className="text-2xl font-bold font-mono text-primary">
              {(parseFloat(selectedPlan.commission.rate) * 100).toFixed(0)}%
            </p>
            <p className="text-sm text-muted">{selectedPlan.commission.description}</p>
          </div>

          {/* Features */}
          <ul className="space-y-3 mb-8">
            {selectedPlan.features.map((feature, i) => (
              <li key={i} className="flex items-start gap-3 text-sm text-text-dark">
                <svg className="h-5 w-5 text-success flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                {feature}
              </li>
            ))}
          </ul>

          <Link to="/register">
            <Button className="w-full" size="lg">
              Comecar agora
            </Button>
          </Link>
        </Card>
      )}

      {/* Updated at */}
      {pricing?.updated_at && (
        <p className="mt-6 text-center text-xs text-muted font-mono">
          Atualizado em: {new Date(pricing.updated_at).toLocaleDateString('pt-BR')}
        </p>
      )}
    </div>
  );
}
