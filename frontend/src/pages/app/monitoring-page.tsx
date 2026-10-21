import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { monitoringApi } from '@/lib/api-client';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import type { MonitoringResult, MonitoringSnapshot } from '@/types/api';

const RESULT_LABEL: Record<MonitoringResult, string> = {
  matching: 'Conforme',
  deviated: 'Divergente',
  unreachable: 'Inacessivel',
};

const RESULT_BADGE: Record<MonitoringResult, 'default' | 'success' | 'warning' | 'error'> = {
  matching: 'success',
  deviated: 'warning',
  unreachable: 'error',
};

// Only "matching" (safety/reach) and "deviated" (attention) map onto a brand accent meaning.
// "unreachable" is a connectivity failure, not a safety/structure/creator/performance signal,
// so it deliberately gets no accent dot -- the error badge alone carries that state.
const RESULT_DOT: Partial<Record<MonitoringResult, string>> = {
  matching: 'var(--color-signal-green)',
  deviated: 'var(--color-performance-orange)',
};

/** Small colored data point used as a motif accent next to a metric, on a thin grid line. */
function MetricDot({ color }: { color: string }) {
  return <span className="inline-block h-2 w-2 rounded-full mr-2" style={{ backgroundColor: color }} />;
}

function deviationSummary(snapshot: MonitoringSnapshot): string | null {
  if (snapshot.last_result === 'unreachable') {
    return 'O link publicado nao pode ser acessado ou o conteudo foi removido.';
  }
  if (snapshot.last_result === 'deviated' && snapshot.deviation_details) {
    const details = snapshot.deviation_details as { field?: string; approved?: string; current?: string };
    if (details.field) {
      return `Campo "${details.field}" mudou. Aprovado: "${details.approved ?? ''}" · Atual: "${details.current ?? ''}"`;
    }
  }
  return null;
}

/**
 * Post-publication monitoring list (US-16b, Could priority). `last_result` distinguishes
 * "deviated" from "unreachable" explicitly (section 3.5) so a removed post is never shown as
 * if it were still matching.
 */
export function MonitoringPage() {
  const [campaignId, setCampaignId] = useState('');
  const [result, setResult] = useState<MonitoringResult | ''>('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['monitoring', campaignId, result],
    queryFn: () => monitoringApi.list({ campaign_id: campaignId || undefined, result: result || undefined }),
  });

  const snapshots = data?.data ?? [];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <CardHeader>
        <CardTitle>Monitoramento de conteudo publicado</CardTitle>
        <CardDescription>Acompanha links publicados em busca de edicoes ou remocao apos a aprovacao.</CardDescription>
      </CardHeader>

      <Card>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="Filtrar por ID da campanha"
            value={campaignId}
            onChange={(e) => setCampaignId(e.target.value)}
          />
          <Select
            label="Filtrar por resultado"
            value={result}
            onChange={(e) => setResult(e.target.value as MonitoringResult | '')}
            options={[
              { value: '', label: 'Todos os resultados' },
              { value: 'matching', label: 'Conforme' },
              { value: 'deviated', label: 'Divergente' },
              { value: 'unreachable', label: 'Inacessivel' },
            ]}
          />
        </div>
      </Card>

      {isLoading && <Spinner />}
      {error && <Alert variant="error">Nao foi possivel carregar o monitoramento agora.</Alert>}

      {!isLoading && !error && snapshots.length === 0 && (
        <Card>
          <p className="text-sm text-muted py-8 text-center">Nenhum conteudo publicado monitorado ainda.</p>
        </Card>
      )}

      {snapshots.length > 0 && (
        <div className="space-y-3">
          {snapshots.map((snap) => (
            <Card key={snap.id}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <a
                    href={snap.published_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm font-medium text-primary hover:underline break-all"
                  >
                    {snap.published_url}
                  </a>
                  <p className="flex items-center font-mono text-xs text-muted mt-1">
                    {snap.last_result && RESULT_DOT[snap.last_result] && <MetricDot color={RESULT_DOT[snap.last_result]!} />}
                    {snap.last_checked_at
                      ? `Verificado em ${new Date(snap.last_checked_at).toLocaleString('pt-BR')}`
                      : 'Ainda nao verificado'}
                  </p>
                </div>
                {snap.last_result && <Badge variant={RESULT_BADGE[snap.last_result]}>{RESULT_LABEL[snap.last_result]}</Badge>}
              </div>
              {deviationSummary(snap) && <p className="text-sm text-text-dark mt-3">{deviationSummary(snap)}</p>}
              {snap.last_result === 'unreachable' && snap.consecutive_unreachable_count !== undefined && (
                <p className="font-mono text-xs text-muted mt-1">
                  Verificacoes consecutivas sem acesso: {snap.consecutive_unreachable_count}
                </p>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
