import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { publicApi } from '@/lib/api-client';
import { Alert } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';

function formatCurrency(amount: string) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(amount));
}

function formatNumber(n: number) {
  return new Intl.NumberFormat('pt-BR').format(n);
}

/** Small colored data point used as a motif accent next to a metric, on a thin grid line. */
function MetricDot({ color }: { color: string }) {
  return <span className="inline-block h-2 w-2 rounded-full mr-2" style={{ backgroundColor: color }} />;
}

/**
 * The one surface in the whole of US-44 an agency's actual client company -- who never logs
 * into Aurora at all -- can open: a token-gated, public view of a client performance report
 * (US-43's figures), rendered under the agency's own branding when configured, per
 * docs/architecture/e9-agency-multi-client-operations.md section 5.5.
 *
 * Deliberately standalone, outside both AppLayout and PublicLayout: neither Aurora's own nav
 * nor its own identity belongs here (ADR-0061, scenario 3) -- when branding.applied is false,
 * the fallback is a neutral, agency- and Aurora-agnostic presentation, never Aurora's own.
 */
export function PublicClientReportPage() {
  const { token } = useParams<{ token: string }>();

  const { data, isLoading, error } = useQuery({
    queryKey: ['public-client-report', token],
    queryFn: () => publicApi.getClientReport(token!),
    enabled: !!token,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (error || !data) {
    const notFound = isAxiosError(error) && error.response?.status === 404;
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <Alert variant="error" className="max-w-md">
          {notFound
            ? 'Este link nao esta mais disponivel. Ele pode ter expirado ou sido revogado.'
            : 'Nao foi possivel carregar este relatorio agora.'}
        </Alert>
      </div>
    );
  }

  const { agency_name, branding, report } = data;
  const primaryColor = branding.applied && branding.primary_color_hex ? branding.primary_color_hex : null;

  return (
    <div className="min-h-screen bg-surface">
      <header
        className="border-b border-border bg-white py-6"
        style={primaryColor ? { borderBottomColor: primaryColor, borderBottomWidth: 3 } : undefined}
      >
        <div className="mx-auto max-w-2xl px-4 flex items-center gap-3">
          {branding.applied && branding.logo_url ? (
            <img src={branding.logo_url} alt={`Logo de ${agency_name}`} className="h-10 w-10 rounded object-cover" />
          ) : null}
          <h1 className="text-lg font-semibold text-text-dark">
            {branding.applied ? agency_name : 'Relatorio de desempenho'}
          </h1>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-8">
        <div className="rounded-xl border border-border bg-white p-6 shadow-sm space-y-3">
          <p className="flex items-center font-mono text-sm text-text-dark">
            <MetricDot color="var(--color-strategy-violet)" />
            Campanhas: {report.campaign_count}
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
          <p className="font-mono text-sm text-text-dark">CPM equivalente: {formatCurrency(report.cpm_equivalent)}</p>

          <div className="flex gap-2 pt-3 border-t border-border">
            {report.pdf_document_url && (
              <a
                href={report.pdf_document_url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-text-dark hover:bg-surface transition-colors"
              >
                Baixar PDF
              </a>
            )}
            {report.csv_document_url && (
              <a
                href={report.csv_document_url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-text-dark hover:bg-surface transition-colors"
              >
                Baixar CSV
              </a>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
