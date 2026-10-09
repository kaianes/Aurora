import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { creatorApi } from '@/lib/api-client';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import type { AuthenticityFlag } from '@/types/api';

/** Small colored data point used as a motif accent next to a metric, on a thin grid line. */
function MetricDot({ color }: { color: string }) {
  return <span className="inline-block h-2 w-2 rounded-full mr-2" style={{ backgroundColor: color }} />;
}

const AUTHENTICITY_BADGE: Record<AuthenticityFlag, 'success' | 'warning' | 'error'> = {
  none: 'success',
  review: 'warning',
  low: 'error',
};

const AUTHENTICITY_LABEL: Record<AuthenticityFlag, string> = {
  none: 'Sem alertas',
  review: 'Revisar: engajamento atipico',
  low: 'Baixa: possivel fraude de seguidores',
};

export function CreatorMetricsPage() {
  const { id: campaignId, creatorId } = useParams<{ id: string; creatorId: string }>();
  const [searchParams] = useSearchParams();

  const { data: metrics, isLoading, error } = useQuery({
    queryKey: ['creator-metrics', creatorId, campaignId],
    queryFn: () => creatorApi.getMetrics(creatorId!, campaignId),
    enabled: !!creatorId,
  });

  if (isLoading) return <Spinner />;
  if (error || !metrics) return <Alert variant="error">Nao foi possivel carregar as metricas deste criador.</Alert>;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <CardHeader>
        <Link
          to={`/app/campaigns/${campaignId}/shortlist${searchParams.get('from') ?? ''}`}
          className="text-sm text-primary hover:underline"
        >
          &larr; Voltar ao shortlist
        </Link>
        <CardTitle className="mt-2">{metrics.display_name}</CardTitle>
        <CardDescription>Metricas de audiencia, engajamento e autenticidade.</CardDescription>
      </CardHeader>

      {metrics.metrics_stale && (
        <Alert variant="warning">
          Metricas desatualizadas desde{' '}
          {metrics.stale_since ? new Date(metrics.stale_since).toLocaleString('pt-BR') : 'data desconhecida'}. A
          conexao com a plataforma social esta temporariamente indisponivel; estes sao os ultimos valores
          conhecidos.
        </Alert>
      )}

      {/* Authenticity surfaced prominently per ADR-0017: flag-only, never used to auto-filter. */}
      <Card className={metrics.authenticity_flag !== 'none' ? 'border-error/50' : undefined}>
        <h3 className="text-sm font-semibold text-text-dark mb-3">Score de autenticidade</h3>
        <div className="flex items-center gap-3">
          <p className="font-mono text-3xl text-text-dark">{metrics.authenticity_score ?? '-'}</p>
          <Badge variant={AUTHENTICITY_BADGE[metrics.authenticity_flag]}>
            {AUTHENTICITY_LABEL[metrics.authenticity_flag]}
          </Badge>
        </div>
        {metrics.authenticity_flag !== 'none' && (
          <p className="text-xs text-muted mt-2">
            Este alerta e apenas informativo: o criador permanece no shortlist. A decisao de aprovar ou rejeitar e
            sua.
          </p>
        )}
      </Card>

      <Card>
        <h3 className="text-sm font-semibold text-text-dark mb-3">Audiencia e engajamento</h3>
        <div className="space-y-2">
          <p className="flex items-center font-mono text-sm text-text-dark">
            <MetricDot color="var(--color-signal-green)" />
            Tamanho da audiencia: {metrics.audience_size?.toLocaleString('pt-BR') ?? '-'}
          </p>
          <p className="flex items-center font-mono text-sm text-text-dark">
            <MetricDot color="var(--color-performance-orange)" />
            Taxa de engajamento: {metrics.engagement_rate ? `${metrics.engagement_rate}%` : '-'}
          </p>
          <p className="flex items-center font-mono text-sm text-text-dark">
            <MetricDot color="var(--color-strategy-violet)" />
            Nicho de conteudo: {metrics.content_niche ?? '-'}
          </p>
        </div>
        {metrics.demographic_composition && (
          <div className="mt-4 border-t border-border pt-3">
            <h4 className="text-xs font-semibold text-muted uppercase mb-2">Composicao demografica</h4>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(metrics.demographic_composition).map(([key, value]) => (
                <p key={key} className="flex items-center font-mono text-xs text-text-dark">
                  <MetricDot color="var(--color-creator-pink)" />
                  {key}: {(value * 100).toFixed(0)}%
                </p>
              ))}
            </div>
          </div>
        )}
        <p className="text-xs text-muted mt-3 font-mono">
          {metrics.metrics_computed_at
            ? `Calculado em ${new Date(metrics.metrics_computed_at).toLocaleString('pt-BR')}`
            : 'Data de calculo indisponivel'}
        </p>
      </Card>

      {metrics.matched_attributes && metrics.matched_attributes.length > 0 && (
        <Card>
          <h3 className="text-sm font-semibold text-text-dark mb-2">Atributos correspondentes a campanha</h3>
          <p className="text-sm text-text-dark">{metrics.matched_attributes.join(', ')}</p>
        </Card>
      )}
    </div>
  );
}
