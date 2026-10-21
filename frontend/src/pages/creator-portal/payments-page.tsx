import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { creatorPortalApi, getCreatorToken } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import { Select } from '@/components/ui/select';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import type { PayoutObligationListItem, PayoutObligationStatus } from '@/types/api';

/** Small colored data point used as a motif accent next to a metric, on a thin grid line. */
function MetricDot({ color }: { color: string }) {
  return <span className="inline-block h-2 w-2 rounded-full mr-2" style={{ backgroundColor: color }} />;
}

function formatCurrency(amount: string) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(amount));
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('pt-BR');
}

const STATUS_LABEL: Record<PayoutObligationStatus, string> = {
  owed: 'Devido',
  in_flight: 'Em transferencia',
  settled: 'Pago',
};

// Not mapped onto a brand-accent dot (Signal Green/Strategy Violet/Creator Pink/Performance
// Orange each carry a specific, different meaning): this is a plain status indicator, using
// the same generic success/warning/default feedback colors every other state badge uses.
const STATUS_BADGE: Record<PayoutObligationStatus, 'default' | 'success' | 'warning' | 'error'> = {
  owed: 'warning',
  in_flight: 'default',
  settled: 'success',
};

function PaymentCard({ obligation }: { obligation: PayoutObligationListItem }) {
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const statementMutation = useMutation({
    mutationFn: () => creatorPortalApi.getPayoutStatement(obligation.id),
    onSuccess: (data) => {
      setDownloadError(null);
      window.open(data.document_url, '_blank', 'noopener,noreferrer');
    },
    onError: () => setDownloadError('Nao foi possivel gerar o extrato agora.'),
  });

  // US-35c: a failed attempt never moves the obligation out of `owed` -- it stays listed as
  // owed, with the reason shown here regardless of whether the outbound notification itself
  // was ever delivered (scenario 3).
  const hasFailure = !!obligation.last_failure_reason;

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-text-dark">{obligation.campaign_name}</h3>
          <p className="text-xs text-muted mt-0.5">{obligation.buyer_name}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {obligation.escalated_for_manual_review && obligation.status !== 'settled' && (
            <Badge variant="warning">Em atencao</Badge>
          )}
          <Badge variant={STATUS_BADGE[obligation.status]}>{STATUS_LABEL[obligation.status]}</Badge>
        </div>
      </div>

      <div className="mt-4 space-y-1.5 border-t border-border pt-3">
        <p className="flex items-center font-mono text-sm text-text-dark">
          <MetricDot color="var(--color-signal-green)" />
          Pagamento bruto: {formatCurrency(obligation.payout_gross)}
        </p>
        <p className="flex items-center font-mono text-sm text-text-dark">
          <MetricDot color="var(--color-performance-orange)" />
          Comissao: {formatCurrency(obligation.payout_commission)}
        </p>
        <p className="flex items-center font-mono text-sm text-text-dark">
          <MetricDot color="var(--color-creator-pink)" />
          Pagamento liquido: {formatCurrency(obligation.payout_net)}
        </p>
      </div>

      <p className="font-mono text-xs text-muted mt-2">
        {obligation.status === 'settled' && obligation.settled_at
          ? `Pago em ${formatDateTime(obligation.settled_at)}`
          : `Prazo combinado: ${formatDateTime(obligation.committed_deadline_at)}`}
      </p>

      {hasFailure && (
        <Alert variant="error" className="mt-3">
          Uma tentativa de pagamento falhou: {obligation.last_failure_reason}. O valor continua devido e uma nova
          tentativa sera feita.
        </Alert>
      )}

      {downloadError && (
        <Alert variant="error" className="mt-3">
          {downloadError}
        </Alert>
      )}

      <div className="mt-4 flex gap-2">
        <Link to={`/creator-portal/payments/${obligation.id}`}>
          <Button variant="outline" size="sm">
            Ver detalhes
          </Button>
        </Link>
        <Button
          variant="outline"
          size="sm"
          onClick={() => statementMutation.mutate()}
          loading={statementMutation.isPending}
        >
          Baixar extrato
        </Button>
      </div>
    </Card>
  );
}

/**
 * Duda's full payment history (US-36a): every obligation she has ever had, each showing
 * gross/commission/net and current status, with a statement download action per line.
 */
export function PaymentsPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<PayoutObligationStatus | ''>('');

  useEffect(() => {
    if (!getCreatorToken()) {
      navigate('/creator-portal/access');
    }
  }, [navigate]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['creator-payout-obligations', status],
    queryFn: () => creatorPortalApi.listPayoutObligations({ status: status || undefined }),
  });

  if (isLoading) return <Spinner />;
  if (error) {
    return (
      <Alert variant="error">
        {isAxiosError(error) && error.response?.data?.error?.message
          ? error.response.data.error.message
          : 'Nao foi possivel carregar seu historico de pagamentos.'}
      </Alert>
    );
  }

  const obligations = data?.data ?? [];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <CardHeader>
        <CardTitle>Seus pagamentos</CardTitle>
        <CardDescription>Veja o que ja foi pago, o que ainda esta devido, e baixe seus extratos.</CardDescription>
      </CardHeader>

      <Card>
        <Select
          label="Filtrar por status"
          value={status}
          onChange={(e) => setStatus(e.target.value as PayoutObligationStatus | '')}
          options={[
            { value: '', label: 'Todos os status' },
            { value: 'owed', label: 'Devido' },
            { value: 'in_flight', label: 'Em transferencia' },
            { value: 'settled', label: 'Pago' },
          ]}
        />
      </Card>

      {obligations.length === 0 ? (
        <Card>
          <p className="text-sm text-muted py-6 text-center">Nenhum pagamento registrado ainda.</p>
        </Card>
      ) : (
        <div className="space-y-4">
          {obligations.map((obligation) => (
            <PaymentCard key={obligation.id} obligation={obligation} />
          ))}
        </div>
      )}
    </div>
  );
}
