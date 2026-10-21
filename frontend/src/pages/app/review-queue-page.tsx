import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { reviewQueueApi } from '@/lib/api-client';
import { useAuth } from '@/contexts/auth-context';
import { canDecideReviewQueue } from '@/lib/roles';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import type { ReviewQueueItem, ReviewQueueStatus, TriggeredRule } from '@/types/api';

const STATUS_LABEL: Record<ReviewQueueStatus, string> = {
  pending: 'Pendente',
  approved: 'Aprovado',
  rejected: 'Rejeitado',
  revision_requested: 'Revisao solicitada',
};

const STATUS_BADGE: Record<ReviewQueueStatus, 'default' | 'success' | 'warning' | 'error'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'error',
  revision_requested: 'default',
};

const CHANNEL_LABEL: Record<string, string> = {
  caption: 'Legenda',
  on_screen_text: 'Texto na tela',
  audio: 'Audio',
  system: 'Sistema',
};

function TriggeredRulesList({ rules }: { rules: TriggeredRule[] }) {
  return (
    <ul className="mt-2 space-y-1">
      {rules.map((rule, i) => (
        <li key={i} className="font-mono text-xs text-text-dark bg-surface rounded px-2 py-1">
          <span className="font-semibold">{CHANNEL_LABEL[rule.channel] ?? rule.channel}</span>
          {rule.rule_type && ` · ${rule.rule_type}`}
          {rule.matched_excerpt && <span className="text-muted"> · "{rule.matched_excerpt}"</span>}
        </li>
      ))}
    </ul>
  );
}

function DecideControls({ itemId }: { itemId: string }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'reject' | 'revision' | null>(null);
  const [reason, setReason] = useState('');
  const [decideError, setDecideError] = useState<string | null>(null);

  const decideMutation = useMutation({
    mutationFn: (vars: { decision: 'approved' | 'rejected' | 'revision_requested'; reason?: string }) =>
      reviewQueueApi.decide(itemId, vars),
    onSuccess: () => {
      setDecideError(null);
      setMode(null);
      setReason('');
      queryClient.invalidateQueries({ queryKey: ['review-queue'] });
    },
    onError: (err) => {
      if (isAxiosError(err) && err.response?.data?.error?.code === 'ALREADY_DECIDED') {
        setDecideError('Este item ja foi decidido em outra aba ou por outra pessoa.');
        queryClient.invalidateQueries({ queryKey: ['review-queue'] });
        return;
      }
      setDecideError(
        isAxiosError(err) && err.response?.data?.error?.message
          ? err.response.data.error.message
          : 'Nao foi possivel registrar a decisao.',
      );
    },
  });

  return (
    <div className="mt-3 space-y-2">
      {decideError && <Alert variant="error">{decideError}</Alert>}
      {mode === null ? (
        <div className="flex gap-2">
          <Button size="sm" onClick={() => decideMutation.mutate({ decision: 'approved' })} loading={decideMutation.isPending}>
            Aprovar
          </Button>
          <Button size="sm" variant="danger" onClick={() => setMode('reject')}>
            Rejeitar
          </Button>
          <Button size="sm" variant="outline" onClick={() => setMode('revision')}>
            Solicitar revisao
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <Textarea
            label={mode === 'reject' ? 'Motivo da rejeicao (obrigatorio)' : 'O que precisa ser revisado (obrigatorio)'}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={mode === 'reject' ? 'danger' : 'primary'}
              disabled={!reason.trim()}
              loading={decideMutation.isPending}
              onClick={() =>
                decideMutation.mutate({
                  decision: mode === 'reject' ? 'rejected' : 'revision_requested',
                  reason: reason.trim(),
                })
              }
            >
              Confirmar
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setMode(null);
                setReason('');
              }}
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Human review queue (US-17). On a 503 (REVIEW_QUEUE_UNAVAILABLE), react-query keeps whatever
 * was last successfully loaded in `data` while `error` is also set -- so a failed refetch shows
 * an explicit error banner on top of the still-flagged items, never an empty or resolved-looking
 * list (scenario 3). If the very first load fails, there is no cached data to fall back on, and
 * only the error is rendered -- never a misleading "no items" empty state.
 */
export function ReviewQueuePage() {
  const { currentRole } = useAuth();
  const canDecide = currentRole ? canDecideReviewQueue(currentRole) : false;
  const [status, setStatus] = useState<ReviewQueueStatus>('pending');

  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ['review-queue', status],
    queryFn: () => reviewQueueApi.list({ status }),
  });

  const items = data?.data ?? [];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle>Fila de revisao de seguranca</CardTitle>
            <CardDescription>Conteudo sinalizado pela verificacao automatica, aguardando uma decisao humana.</CardDescription>
          </div>
          <Select
            aria-label="Filtrar por status"
            value={status}
            onChange={(e) => setStatus(e.target.value as ReviewQueueStatus)}
            options={[
              { value: 'pending', label: 'Pendentes' },
              { value: 'approved', label: 'Aprovados' },
              { value: 'rejected', label: 'Rejeitados' },
              { value: 'revision_requested', label: 'Revisao solicitada' },
            ]}
          />
        </div>
      </CardHeader>

      {error && (
        <Alert variant="error">
          <p>
            Nao foi possivel carregar a fila de revisao agora.{' '}
            {isAxiosError(error) && error.response?.data?.error?.message
              ? error.response.data.error.message
              : 'Tente novamente em alguns instantes.'}
          </p>
          {items.length > 0 && (
            <p className="mt-1">O conteudo sinalizado abaixo permanece bloqueado e nao publicado enquanto isso.</p>
          )}
          <Button size="sm" variant="outline" className="mt-2" onClick={() => refetch()}>
            Tentar novamente
          </Button>
        </Alert>
      )}

      {isLoading && <Spinner />}

      {!isLoading && !error && items.length === 0 && (
        <Card>
          <p className="text-sm text-muted py-8 text-center">Nenhum item nesta fila.</p>
        </Card>
      )}

      {items.length > 0 && (
        <div className="space-y-4">
          {items.map((item: ReviewQueueItem) => (
            <Card key={item.id}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <Link to={`/app/safety/review-queue/${item.id}`} className="text-sm font-medium text-primary hover:underline">
                    {item.campaign_name}
                  </Link>
                  <p className="text-xs text-muted mt-0.5">Criador: {item.creator_display_name}</p>
                  <p className="font-mono text-xs text-muted mt-0.5">{new Date(item.created_at).toLocaleString('pt-BR')}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant={item.reason_category === 'check_unavailable' ? 'default' : 'error'}>
                    {item.reason_category === 'check_unavailable' ? 'Verificacao indisponivel' : 'Regra violada'}
                  </Badge>
                  <Badge variant={STATUS_BADGE[item.status]}>{STATUS_LABEL[item.status]}</Badge>
                </div>
              </div>

              <TriggeredRulesList rules={item.triggered_rules} />

              {item.status === 'pending' && canDecide && <DecideControls itemId={item.id} />}

              {item.status !== 'pending' && item.decision_reason && (
                <p className="text-xs text-muted mt-2">Motivo registrado: {item.decision_reason}</p>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
