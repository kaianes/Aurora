import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { agencyApi, setCurrentAccountId } from '@/lib/api-client';
import { useAuth } from '@/contexts/auth-context';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';

function formatCurrency(amount: string | null) {
  if (!amount) return '-';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(amount));
}

function formatNumber(n: number | null) {
  if (n === null) return '-';
  return new Intl.NumberFormat('pt-BR').format(n);
}

/** Small colored data point used as a motif accent next to a metric, on a thin grid line. */
function MetricDot({ color }: { color: string }) {
  return <span className="inline-block h-2 w-2 rounded-full mr-2" style={{ backgroundColor: color }} />;
}

/**
 * Renata's per-client report (US-43): spend, delivered reach/engagement, and cost efficiency
 * across every campaign under one client account, rendered under her agency's own branding
 * when one is configured (ADR-0048), falling back to a neutral template otherwise.
 *
 * Per docs/architecture/e7-analytics-reporting.md section 2.5, the request must carry
 * X-Account-Id set to the client account itself, not the agency's home account -- this page
 * temporarily switches account context for the duration of each call, the same pattern
 * client-detail-page already uses for brand-profile operations on a client account, restoring
 * it immediately after.
 */
export function ClientReportPage() {
  const { id: clientId } = useParams<{ id: string }>();
  const { workspace } = useAuth();
  const originalAccountId = workspace?.current_account?.id;
  const [reportId, setReportId] = useState<string | null>(null);

  const { data: clients } = useQuery({
    queryKey: ['agency-clients'],
    queryFn: () => agencyApi.listClients(),
  });
  const client = clients?.data.find((c) => c.id === clientId);

  const requestMutation = useMutation({
    mutationFn: () => {
      if (clientId) setCurrentAccountId(clientId);
      return agencyApi.requestClientReport(clientId!);
    },
    onSuccess: (data) => setReportId(data.report_id),
    onSettled: () => {
      if (originalAccountId) setCurrentAccountId(originalAccountId);
    },
  });

  const { data: report, error: reportError } = useQuery({
    queryKey: ['client-report', clientId, reportId],
    queryFn: () => {
      if (clientId) setCurrentAccountId(clientId);
      return agencyApi.getClientReport(clientId!, reportId!).finally(() => {
        if (originalAccountId) setCurrentAccountId(originalAccountId);
      });
    },
    enabled: !!clientId && !!reportId,
    refetchInterval: (query) => (query.state.data?.status === 'pending' ? 2000 : false),
  });

  const requestErrorMessage =
    isAxiosError(requestMutation.error) && requestMutation.error.response?.data?.error?.message
      ? requestMutation.error.response.data.error.message
      : requestMutation.isError
        ? 'Nao foi possivel solicitar o relatorio agora.'
        : null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <CardHeader>
        <CardTitle>Relatorio do cliente</CardTitle>
        <CardDescription>{client?.name ?? 'Cliente'}</CardDescription>
      </CardHeader>

      {requestErrorMessage && <Alert variant="error">{requestErrorMessage}</Alert>}
      {reportError && (
        <Alert variant="error">
          {isAxiosError(reportError) && reportError.response?.data?.error?.message
            ? reportError.response.data.error.message
            : 'Nao foi possivel carregar o relatorio solicitado.'}
        </Alert>
      )}

      {!report && (
        <Card>
          <p className="text-sm text-text-dark mb-4">
            Gere um relatorio consolidado de todas as campanhas deste cliente, com alcance, engajamento e
            eficiencia de custo, pronto para entregar como trabalho da sua agencia.
          </p>
          <Button onClick={() => requestMutation.mutate()} loading={requestMutation.isPending}>
            Gerar relatorio
          </Button>
        </Card>
      )}

      {report?.status === 'pending' && (
        <Card>
          <div className="flex items-center gap-3 text-sm text-muted">
            <Spinner className="h-5 w-5" />
            Gerando relatorio. Isso pode levar alguns segundos.
          </div>
        </Card>
      )}

      {report?.status === 'failed' && (
        <Alert variant="error">Nao foi possivel gerar o relatorio agora. Tente novamente.</Alert>
      )}

      {report?.status === 'ready' && (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-text-dark">Relatorio #{report.id}</h3>
            <Badge variant={report.branding_applied ? 'success' : 'default'}>
              {report.branding_applied ? 'Com marca da agencia' : 'Sem marca configurada'}
            </Badge>
          </div>

          {!report.branding_applied && (
            <p className="text-xs text-muted mb-3">
              Configure o logo e as cores da sua agencia para que aparecam nos proximos relatorios.{' '}
              <Link to="/app/agency/branding" className="text-primary underline">
                Configurar marca da agencia
              </Link>
            </p>
          )}

          <div className="space-y-2 border-t border-border pt-3">
            <p className="flex items-center font-mono text-sm text-text-dark">
              <MetricDot color="var(--color-strategy-violet)" />
              Campanhas: {report.campaign_count ?? '-'}
            </p>
            <p className="flex items-center font-mono text-sm text-text-dark">
              <MetricDot color="var(--color-creator-pink)" />
              Investimento total: {formatCurrency(report.total_spend)}
            </p>
            <p className="flex items-center font-mono text-sm text-text-dark">
              <MetricDot color="var(--color-signal-green)" />
              Alcance entregue: {formatNumber(report.total_delivered_reach)}
            </p>
            <p className="flex items-center font-mono text-sm text-text-dark">
              <MetricDot color="var(--color-performance-orange)" />
              Engajamento entregue: {formatNumber(report.total_delivered_engagement)}
            </p>
            <p className="font-mono text-sm text-text-dark">
              Custo por engajamento: {formatCurrency(report.cost_per_engagement)}
            </p>
            <p className="font-mono text-sm text-text-dark">
              CPM equivalente: {formatCurrency(report.cpm_equivalent)}
            </p>
          </div>

          <div className="flex gap-2 mt-4">
            {report.pdf_document_url && (
              <a href={report.pdf_document_url} target="_blank" rel="noopener noreferrer">
                <Button variant="outline" size="sm">
                  Baixar PDF
                </Button>
              </a>
            )}
            {report.csv_document_url && (
              <a href={report.csv_document_url} target="_blank" rel="noopener noreferrer">
                <Button variant="outline" size="sm">
                  Baixar CSV
                </Button>
              </a>
            )}
          </div>

          <div className="mt-4">
            <Button variant="ghost" size="sm" onClick={() => setReportId(null)}>
              Gerar novo relatorio
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
