import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { briefingApi } from '@/lib/api-client';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';

/** Small colored data point used as a motif accent next to a metric, on a thin grid line. */
function MetricDot({ color }: { color: string }) {
  return <span className="inline-block h-2 w-2 rounded-full mr-2" style={{ backgroundColor: color }} />;
}

/**
 * Distribution outcome (US-18b scenario 3): polls the async fan-out until nothing is left
 * `pending`, then shows exactly which creators the briefing failed to reach, never collapsing a
 * partial failure into a misleading "sent" summary.
 */
export function BriefingDistributionPage() {
  const { id } = useParams<{ id: string }>();

  const { data: distribution, error, isLoading } = useQuery({
    queryKey: ['briefing-distribution', id],
    queryFn: () => briefingApi.getDistribution(id!),
    enabled: !!id,
    refetchInterval: (query) => (query.state.data && query.state.data.pending > 0 ? 2000 : false),
  });

  if (isLoading) return <Spinner />;
  if (error) {
    return (
      <Alert variant="error">
        {isAxiosError(error) && error.response?.data?.error?.message
          ? error.response.data.error.message
          : 'Nao foi possivel carregar o status de distribuicao deste briefing.'}
      </Alert>
    );
  }
  if (!distribution) return null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <CardHeader>
        <CardTitle>Status de distribuicao do briefing</CardTitle>
        <CardDescription>
          <Link to={`/app/campaigns/${id}/briefing`} className="text-primary hover:underline">
            Voltar para o briefing
          </Link>
        </CardDescription>
      </CardHeader>

      <Card>
        <div className="space-y-2">
          <p className="flex items-center font-mono text-sm text-text-dark">
            <MetricDot color="var(--color-strategy-violet)" />
            Total de destinatarios: {distribution.recipients_total}
          </p>
          <p className="flex items-center font-mono text-sm text-text-dark">
            <MetricDot color="var(--color-signal-green)" />
            Entregues: {distribution.delivered}
          </p>
          <p className="flex items-center font-mono text-sm text-text-dark">
            <MetricDot color="var(--color-performance-orange)" />
            Com falha: {distribution.failed.length}
          </p>
          {distribution.pending > 0 && (
            <div className="flex items-center gap-3 text-sm text-muted">
              <Spinner className="h-5 w-5" />
              {distribution.pending} ainda em processamento.
            </div>
          )}
        </div>
      </Card>

      {distribution.failed.length > 0 && (
        <Card>
          <h3 className="text-sm font-semibold text-text-dark mb-3">Criadores que o briefing nao alcancou</h3>
          <div className="divide-y divide-border">
            {distribution.failed.map((f) => (
              <div key={f.creator_id} className="flex items-center justify-between py-2 gap-4">
                <span className="font-mono text-sm text-text-dark">{f.creator_id}</span>
                <Badge variant="error">{f.failure_reason}</Badge>
              </div>
            ))}
          </div>
        </Card>
      )}

      {distribution.pending === 0 && distribution.failed.length === 0 && distribution.recipients_total > 0 && (
        <Alert variant="success">O briefing alcancou todos os {distribution.recipients_total} criadores do pool.</Alert>
      )}
    </div>
  );
}
