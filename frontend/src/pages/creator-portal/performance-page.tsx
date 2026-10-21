import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { creatorPortalApi, getCreatorToken } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import type { CreatorPerformanceEntry, IngestionStatus } from '@/types/api';

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

const INGESTION_BADGE: Record<IngestionStatus, 'default' | 'success' | 'warning' | 'error'> = {
  pending_first_pull: 'default',
  fresh: 'success',
  stale_rate_limited: 'warning',
  stale_unreachable: 'warning',
  stale_auth_revoked: 'error',
};

function PerformanceCard({ entry }: { entry: CreatorPerformanceEntry }) {
  // US-37 scenario 2: stale metrics still show the last-known figures, never a blank state.
  const stale = entry.ingestion_status !== 'fresh' && entry.ingestion_status !== 'pending_first_pull';

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-text-dark">{entry.campaign_name}</h3>
          <a
            href={entry.published_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary hover:underline"
          >
            Ver publicacao
          </a>
        </div>
        <Badge variant={INGESTION_BADGE[entry.ingestion_status]} className="shrink-0">
          {INGESTION_LABEL[entry.ingestion_status]}
        </Badge>
      </div>

      <div className="mt-4 space-y-1.5 border-t border-border pt-3">
        <p className="flex items-center font-mono text-sm text-text-dark">
          <MetricDot color="var(--color-signal-green)" />
          Alcance: {formatNumber(entry.reach)}
        </p>
        <p className="flex items-center font-mono text-sm text-text-dark">
          <MetricDot color="var(--color-performance-orange)" />
          Engajamento: {formatNumber(entry.engagement)}
        </p>
        <p className="flex items-center font-mono text-sm text-text-dark">
          <MetricDot color="var(--color-strategy-violet)" />
          Impressoes: {formatNumber(entry.impressions)}
        </p>
      </div>

      {stale && (
        <Alert variant="warning" className="mt-3">
          Metricas desatualizadas. Ultima coleta bem-sucedida: {formatDateTime(entry.last_successful_pull_at)}.
        </Alert>
      )}

      <p className="font-mono text-xs text-muted mt-3">Publicado em {formatDateTime(entry.published_at)}</p>
    </Card>
  );
}

/**
 * Duda's own performance view (US-37): one card per published piece of content, scoped
 * entirely to her own creator identity (enforced server-side from her JWT, never a parameter),
 * with staleness clearly marked, and nothing shown for an opportunity she declined or has not
 * yet delivered -- never a fabricated zero. Per
 * docs/architecture/e7-analytics-reporting.md section 5.4.
 */
export function CreatorPerformancePage() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!getCreatorToken()) {
      navigate('/creator-portal/access');
    }
  }, [navigate]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['creator-performance'],
    queryFn: () => creatorPortalApi.listPerformance(),
  });

  if (isLoading) return <Spinner />;
  if (error) {
    return (
      <Alert variant="error">
        {isAxiosError(error) && error.response?.data?.error?.message
          ? error.response.data.error.message
          : 'Nao foi possivel carregar seu desempenho agora.'}
      </Alert>
    );
  }

  const entries = data?.data ?? [];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <CardHeader>
        <CardTitle>Seu desempenho</CardTitle>
        <CardDescription>Alcance e engajamento de cada conteudo que voce publicou.</CardDescription>
      </CardHeader>

      {entries.length === 0 ? (
        <Card>
          <p className="text-sm text-muted py-6 text-center">Nenhum conteudo publicado ainda.</p>
        </Card>
      ) : (
        <div className="space-y-4">
          {entries.map((entry) => (
            <PerformanceCard key={entry.content_submission_id} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}
