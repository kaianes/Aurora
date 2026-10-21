import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { agencyApi } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';

/** Small colored data point used as a motif accent next to a metric, on a thin grid line. */
function MetricDot({ color }: { color: string }) {
  return <span className="inline-block h-2 w-2 rounded-full mr-2" style={{ backgroundColor: color }} />;
}

function formatCurrency(amount: string) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(amount));
}

function formatNumber(n: number) {
  return new Intl.NumberFormat('pt-BR').format(n);
}

/**
 * Renata's cross-client comparison (US-46): each selected client's own totals and
 * per-campaign averages, side by side within her own agency workspace. Totals are never
 * normalized in a way that would imply false equivalence between a client with one campaign
 * and a client with many (scenario 2), and any client she requested but cannot access is
 * listed explicitly as refused rather than silently dropped (scenario 3).
 * Per docs/architecture/e7-analytics-reporting.md section 5.6.
 */
export function ReportsComparePage() {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [comparedIds, setComparedIds] = useState<string[] | null>(null);

  const { data: clients, isLoading: loadingClients } = useQuery({
    queryKey: ['agency-clients'],
    queryFn: () => agencyApi.listClients(),
  });

  const {
    data: comparison,
    isLoading: loadingComparison,
    error,
  } = useQuery({
    queryKey: ['agency-reports-compare', comparedIds?.join(',')],
    queryFn: () => agencyApi.compareReports(comparedIds!),
    enabled: !!comparedIds && comparedIds.length > 0,
  });

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const errorMessage =
    isAxiosError(error) && error.response?.data?.error?.message
      ? error.response.data.error.message
      : error
        ? 'Nao foi possivel comparar os clientes selecionados.'
        : null;

  if (loadingClients) return <Spinner />;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <CardHeader>
        <CardTitle>Comparar clientes</CardTitle>
        <CardDescription>Veja o desempenho de varios clientes lado a lado.</CardDescription>
      </CardHeader>

      <Card>
        <h3 className="text-sm font-semibold text-text-dark mb-3">Selecione os clientes</h3>
        {clients && clients.data.length > 0 ? (
          <div className="space-y-2 mb-4">
            {clients.data.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm text-text-dark">
                <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
                {c.name}
              </label>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted mb-4">Nenhuma conta de cliente disponivel.</p>
        )}
        <Button
          onClick={() => setComparedIds(Array.from(selected))}
          disabled={selected.size === 0}
          loading={loadingComparison}
        >
          Comparar
        </Button>
      </Card>

      {errorMessage && <Alert variant="error">{errorMessage}</Alert>}

      {comparison && (
        <Card>
          <h3 className="text-sm font-semibold text-text-dark mb-3">Resultados</h3>
          <div className="divide-y divide-border">
            {comparison.data.map((entry) => (
              <div key={entry.client_account_id} className="py-3">
                <p className="text-sm font-medium text-text-dark mb-2">{entry.client_name}</p>
                <div className="grid grid-cols-2 gap-2 font-mono text-xs text-text-dark">
                  <p className="flex items-center">
                    <MetricDot color="var(--color-strategy-violet)" />
                    {entry.campaign_count} campanha(s)
                  </p>
                  <p className="flex items-center">
                    <MetricDot color="var(--color-creator-pink)" />
                    Investimento total: {formatCurrency(entry.total_spend)}
                  </p>
                  <p className="flex items-center">
                    <MetricDot color="var(--color-signal-green)" />
                    Alcance total: {formatNumber(entry.total_delivered_reach)}
                  </p>
                  <p className="flex items-center">
                    <MetricDot color="var(--color-performance-orange)" />
                    Engajamento total: {formatNumber(entry.total_delivered_engagement)}
                  </p>
                  <p className="text-muted">
                    Media de alcance/campanha: {formatNumber(entry.average_reach_per_campaign)}
                  </p>
                  <p className="text-muted">
                    Media de engajamento/campanha: {formatNumber(entry.average_engagement_per_campaign)}
                  </p>
                </div>
              </div>
            ))}
            {comparison.data.length === 0 && (
              <p className="text-sm text-muted py-6 text-center">
                Nenhum dos clientes selecionados pode ser incluido na comparacao.
              </p>
            )}
          </div>

          {comparison.refused.length > 0 && (
            <div className="mt-4 border-t border-border pt-3 space-y-2">
              <h4 className="text-xs font-semibold text-muted uppercase">Nao incluidos na comparacao</h4>
              {comparison.refused.map((r) => (
                <div key={r.client_account_id} className="flex items-center justify-between text-sm">
                  <span className="font-mono text-xs text-muted">{r.client_account_id}</span>
                  <Badge variant="warning">Sem acesso</Badge>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
