import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { campaignApi } from '@/lib/api-client';
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

function formatDateTime(iso: string | null) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('pt-BR');
}

/** Small colored data point used as a motif accent next to a metric, on a thin grid line. */
function MetricDot({ color }: { color: string }) {
  return <span className="inline-block h-2 w-2 rounded-full mr-2" style={{ backgroundColor: color }} />;
}

const SPEND_SOURCE_LABEL: Record<string, string> = {
  locked_price: 'Preco fechado na confirmacao da campanha',
  invoice: 'Fatura consolidada',
};

/**
 * Marina's single-campaign ROI export (US-22): spend, delivered reach/engagement, and cost
 * efficiency for one campaign, available as PDF and CSV. Follows the same request-then-poll
 * flow client-report-page.tsx already established for US-43 (202 + poll_url), per
 * docs/architecture/e7-analytics-reporting.md section 5.3.
 */
export function CampaignReportPage() {
  const { id: campaignId } = useParams<{ id: string }>();
  const [reportId, setReportId] = useState<string | null>(null);

  const { data: campaign } = useQuery({
    queryKey: ['campaign', campaignId],
    queryFn: () => campaignApi.get(campaignId!),
    enabled: !!campaignId,
  });

  const requestMutation = useMutation({
    mutationFn: () => campaignApi.requestReport(campaignId!),
    onSuccess: (data) => setReportId(data.report_id),
  });

  const { data: report, error: reportError } = useQuery({
    queryKey: ['campaign-report', campaignId, reportId],
    queryFn: () => campaignApi.getReport(campaignId!, reportId!),
    enabled: !!campaignId && !!reportId,
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
        <CardTitle>Relatorio da campanha</CardTitle>
        <CardDescription>{campaign?.name ?? 'Campanha'}</CardDescription>
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
            Gere um relatorio desta campanha com investimento, alcance e engajamento entregues, e
            eficiencia de custo, pronto para apresentar ao seu CMO ou CFO.
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
            <Badge variant={report.campaign_progress_label === 'final' ? 'success' : 'default'}>
              {report.campaign_progress_label === 'final' ? 'Campanha finalizada' : 'Campanha em andamento'}
            </Badge>
          </div>

          {report.campaign_progress_label === 'in_progress' && (
            <p className="text-xs text-muted mb-3">
              Esta campanha ainda esta em andamento. Os valores abaixo refletem o investimento ja
              definido e as entregas confirmadas até agora, nao um resultado final.
            </p>
          )}

          <div className="space-y-2 border-t border-border pt-3">
            <p className="flex items-center font-mono text-sm text-text-dark">
              <MetricDot color="var(--color-creator-pink)" />
              Investimento: {formatCurrency(report.spend_amount)}
            </p>
            {report.spend_source && (
              <p className="text-xs text-muted">
                Fonte do valor: {SPEND_SOURCE_LABEL[report.spend_source] ?? report.spend_source}
              </p>
            )}

            {report.has_deliveries === false ? (
              <Alert variant="warning" className="mt-3">
                {report.message ?? 'Nenhuma entrega confirmada ainda.'}
              </Alert>
            ) : (
              <>
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
              </>
            )}
          </div>

          <p className="font-mono text-xs text-muted mt-3">
            Gerado em {formatDateTime(report.resolved_at)}
          </p>

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
