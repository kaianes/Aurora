import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { creatorPortalApi, getCreatorToken } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import type { PayoutExecutionAttempt, PayoutObligationStatus } from '@/types/api';

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

const STATUS_BADGE: Record<PayoutObligationStatus, 'default' | 'success' | 'warning' | 'error'> = {
  owed: 'warning',
  in_flight: 'default',
  settled: 'success',
};

const ATTEMPT_OUTCOME_LABEL: Record<PayoutExecutionAttempt['outcome'], string> = {
  instructed: 'Instruido',
  failed: 'Falhou',
};

const ATTEMPT_TRIGGER_LABEL: Record<PayoutExecutionAttempt['trigger'], string> = {
  scheduled: 'Automatico',
  manual: 'Manual (operacao Aurora)',
};

/**
 * Obligation detail (US-35a/b/c, US-36a, US-36b): execution attempt history (every attempt,
 * not only the latest, so "why has this failed before" is answerable from Duda's own view),
 * failure reasons, and tax document status/download once settled.
 */
export function PaymentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    if (!getCreatorToken()) {
      navigate('/creator-portal/login');
    }
  }, [navigate]);

  const { data: obligation, isLoading, error } = useQuery({
    queryKey: ['creator-payout-obligation', id],
    queryFn: () => creatorPortalApi.getPayoutObligation(id!),
    enabled: !!id,
  });

  const { data: taxDocument, isLoading: isLoadingTaxDocument } = useQuery({
    queryKey: ['creator-payout-tax-document', id],
    queryFn: () => creatorPortalApi.getTaxDocument(id!),
    enabled: !!id && obligation?.status === 'settled',
  });

  const statementMutation = useMutation({
    mutationFn: () => creatorPortalApi.getPayoutStatement(id!),
    onSuccess: (data) => {
      setDownloadError(null);
      window.open(data.document_url, '_blank', 'noopener,noreferrer');
    },
    onError: () => setDownloadError('Nao foi possivel gerar o extrato agora.'),
  });

  if (isLoading) return <Spinner />;
  if (error || !obligation) {
    return (
      <Alert variant="error">
        {isAxiosError(error) && error.response?.data?.error?.message
          ? error.response.data.error.message
          : 'Nao foi possivel carregar este pagamento.'}
      </Alert>
    );
  }

  const attempts = obligation.payout_execution_attempts ?? [];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>{obligation.campaign_name}</CardTitle>
            <CardDescription>{obligation.buyer_name}</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {obligation.escalated_for_manual_review && obligation.status !== 'settled' && (
              <Badge variant="warning">Em atencao</Badge>
            )}
            <Badge variant={STATUS_BADGE[obligation.status]}>{STATUS_LABEL[obligation.status]}</Badge>
          </div>
        </div>
      </CardHeader>

      <Card>
        <h3 className="text-sm font-semibold text-text-dark mb-3">Valores</h3>
        <div className="space-y-1.5">
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
        <p className="font-mono text-xs text-muted mt-3">
          {obligation.status === 'settled' && obligation.settled_at
            ? `Pago em ${formatDateTime(obligation.settled_at)}`
            : `Prazo combinado: ${formatDateTime(obligation.committed_deadline_at)}`}
        </p>

        {obligation.last_failure_reason && (
          <Alert variant="error" className="mt-3">
            Ultima falha: {obligation.last_failure_reason}. O valor continua devido e uma nova tentativa sera feita.
          </Alert>
        )}

        {downloadError && (
          <Alert variant="error" className="mt-3">
            {downloadError}
          </Alert>
        )}

        <div className="mt-4">
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

      <Card>
        <h3 className="text-sm font-semibold text-text-dark mb-3">Historico de tentativas</h3>
        {attempts.length === 0 ? (
          <p className="text-sm text-muted">Nenhuma tentativa de transferencia registrada ainda.</p>
        ) : (
          <div className="space-y-2">
            {attempts.map((attempt) => (
              <div key={attempt.id} className="flex items-start justify-between gap-3 text-sm border-t border-border pt-2 first:border-t-0 first:pt-0">
                <div className="min-w-0">
                  <p className="font-mono text-xs text-muted">{formatDateTime(attempt.created_at)}</p>
                  <p className="text-text-dark">{ATTEMPT_TRIGGER_LABEL[attempt.trigger]}</p>
                  {attempt.failure_reason && <p className="text-xs text-error mt-0.5">{attempt.failure_reason}</p>}
                </div>
                <Badge variant={attempt.outcome === 'instructed' ? 'success' : 'error'}>
                  {ATTEMPT_OUTCOME_LABEL[attempt.outcome]}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </Card>

      {obligation.status === 'settled' && (
        <Card>
          <h3 className="text-sm font-semibold text-text-dark mb-3">Documento fiscal</h3>
          {isLoadingTaxDocument ? (
            <Spinner className="h-5 w-5" />
          ) : !taxDocument ? (
            <p className="text-sm text-muted">Documento fiscal ainda nao disponivel.</p>
          ) : taxDocument.status === 'generated' ? (
            <div className="space-y-2">
              <p className="font-mono text-sm text-text-dark">Periodo: {taxDocument.tax_period}</p>
              {taxDocument.document_url && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(taxDocument.document_url, '_blank', 'noopener,noreferrer')}
                >
                  Baixar documento fiscal
                </Button>
              )}
            </div>
          ) : (
            <Alert variant="warning">
              {taxDocument.message ??
                'Para gerar seu documento fiscal, e necessario completar algumas informacoes do seu perfil.'}
            </Alert>
          )}
        </Card>
      )}

      <Button variant="ghost" size="sm" onClick={() => navigate('/creator-portal/payments')}>
        Voltar para pagamentos
      </Button>
    </div>
  );
}
