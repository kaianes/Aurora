import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { campaignApi } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import type { DashboardCreatorEntry, IngestionStatus } from '@/types/api';

/** Small colored data point used as a motif accent next to a metric, on a thin grid line. */
function MetricDot({ color }: { color: string }) {
  return <span className="inline-block h-2 w-2 rounded-full mr-2" style={{ backgroundColor: color }} />;
}

function formatNumber(n: number | null) {
  if (n === null) return '-';
  return new Intl.NumberFormat('pt-BR').format(n);
}

function formatDateTime(iso: string | null) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('pt-BR');
}

const INGESTION_LABEL: Record<IngestionStatus, string> = {
  pending_first_pull: 'Aguardando primeira coleta',
  fresh: 'Atualizado',
  stale_rate_limited: 'Desatualizado (limite da plataforma)',
  stale_unreachable: 'Desatualizado (plataforma indisponivel)',
  stale_auth_revoked: 'Autorizacao perdida',
};

// US-21a scenario 3: a permanently lost authorization is never conflated with a transient
// rate-limit/outage failure -- the three stale states each render a distinct label, and only
// stale_auth_revoked uses the error (not warning) tone.
const INGESTION_BADGE: Record<IngestionStatus, 'default' | 'success' | 'warning' | 'error'> = {
  pending_first_pull: 'default',
  fresh: 'success',
  stale_rate_limited: 'warning',
  stale_unreachable: 'warning',
  stale_auth_revoked: 'error',
};

function CreatorRow({ creator }: { creator: DashboardCreatorEntry }) {
  return (
    <div className="flex items-center justify-between py-3 gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-text-dark">{creator.display_name}</p>
        {creator.status === 'delivered' ? (
          <div className="flex items-center flex-wrap gap-x-3 font-mono text-xs text-muted mt-1">
            <span className="flex items-center">
              <MetricDot color="var(--color-signal-green)" />
              Alcance: {formatNumber(creator.reach)}
            </span>
            <span className="flex items-center">
              <MetricDot color="var(--color-performance-orange)" />
              Engajamento: {formatNumber(creator.engagement)}
            </span>
            <span className="flex items-center">
              <MetricDot color="var(--color-strategy-violet)" />
              Impressoes: {formatNumber(creator.impressions)}
            </span>
          </div>
        ) : (
          // US-21b scenario 2: never a zeroed figure, indistinguishable from a real zero result.
          <p className="text-xs text-muted mt-1">Entrega pendente -- ainda sem publicacao confirmada.</p>
        )}
        {creator.last_successful_pull_at && (
          <p className="font-mono text-xs text-muted mt-1">
            Ultima coleta: {formatDateTime(creator.last_successful_pull_at)}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Badge variant={creator.status === 'delivered' ? 'success' : 'default'}>
          {creator.status === 'delivered' ? 'Entregue' : 'Pendente'}
        </Badge>
        {creator.ingestion_status && (
          <Badge variant={INGESTION_BADGE[creator.ingestion_status]}>
            {INGESTION_LABEL[creator.ingestion_status]}
          </Badge>
        )}
      </div>
    </div>
  );
}

/**
 * Marina's unified dashboard (US-21b): results by creator and by pool, in a single view,
 * reading campaign_performance_aggregate directly rather than recomputing at request time
 * (NFR-02). Per docs/architecture/e7-analytics-reporting.md section 5.2.
 */
export function CampaignDashboardPage() {
  const { id } = useParams<{ id: string }>();

  const { data: campaign } = useQuery({
    queryKey: ['campaign', id],
    queryFn: () => campaignApi.get(id!),
    enabled: !!id,
  });

  const { data: dashboard, isLoading, error } = useQuery({
    queryKey: ['campaign-dashboard', id],
    queryFn: () => campaignApi.getDashboard(id!),
    enabled: !!id,
  });

  if (isLoading) return <Spinner />;
  if (error || !dashboard) {
    return (
      <Alert variant="error">
        {isAxiosError(error) && error.response?.data?.error?.message
          ? error.response.data.error.message
          : 'Nao foi possivel carregar o dashboard desta campanha.'}
      </Alert>
    );
  }

  const { pool_aggregate } = dashboard;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <CardHeader>
        <CardTitle>Dashboard de desempenho</CardTitle>
        <CardDescription>{campaign?.name ?? 'Campanha'}</CardDescription>
      </CardHeader>

      {pool_aggregate.any_stale && (
        <Alert variant="warning">
          Algumas metricas podem estar desatualizadas. Os valores abaixo sao os ultimos conhecidos para cada
          criador, cada um marcado individualmente abaixo.
        </Alert>
      )}

      <Card>
        <h3 className="text-sm font-semibold text-text-dark mb-3">Pool</h3>
        <div className="flex items-center gap-4 font-mono text-sm text-text-dark">
          <span className="flex items-center">
            <MetricDot color="var(--color-creator-pink)" />
            {dashboard.delivered_count} entregue(s)
          </span>
          <span className="flex items-center">
            <MetricDot color="var(--color-strategy-violet)" />
            {dashboard.pending_delivery_count} pendente(s)
          </span>
          <span className="text-muted">de {dashboard.pool_size} no pool</span>
        </div>
      </Card>

      <Card>
        <h3 className="text-sm font-semibold text-text-dark mb-3">
          Totais do pool (apenas criadores que entregaram)
        </h3>
        <div className="space-y-2">
          <p className="flex items-center font-mono text-sm text-text-dark">
            <MetricDot color="var(--color-signal-green)" />
            Alcance total: {formatNumber(pool_aggregate.total_delivered_reach)}
          </p>
          <p className="flex items-center font-mono text-sm text-text-dark">
            <MetricDot color="var(--color-performance-orange)" />
            Engajamento total: {formatNumber(pool_aggregate.total_delivered_engagement)}
          </p>
          <p className="flex items-center font-mono text-sm text-text-dark">
            <MetricDot color="var(--color-strategy-violet)" />
            Impressoes totais: {formatNumber(pool_aggregate.total_delivered_impressions)}
          </p>
        </div>
        <p className="text-xs text-muted mt-3 font-mono">
          Calculado em {formatDateTime(pool_aggregate.last_computed_at)}
        </p>
      </Card>

      <Card>
        <h3 className="text-sm font-semibold text-text-dark mb-3">Resultados por criador</h3>
        {dashboard.creators.length > 0 ? (
          <div className="divide-y divide-border">
            {dashboard.creators.map((creator) => (
              <CreatorRow key={creator.creator_id} creator={creator} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted py-6 text-center">Nenhum criador no pool ainda.</p>
        )}
      </Card>
    </div>
  );
}
