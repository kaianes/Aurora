import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { reviewQueueApi } from '@/lib/api-client';
import { useAuth } from '@/contexts/auth-context';
import { canDecideReviewQueue } from '@/lib/roles';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import type { ReviewQueueStatus } from '@/types/api';

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

/**
 * Flagged item detail (US-17): full submission content, every triggered rule with its full
 * definition, tier reached, and decision history once decided. A load failure here leaves the
 * submission's own blocked/flagged status untouched (section 2.8) -- this page only renders an
 * explicit error, it never implies the item is resolved.
 */
export function ReviewQueueDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { currentRole } = useAuth();
  const canDecide = currentRole ? canDecideReviewQueue(currentRole) : false;
  const [mode, setMode] = useState<'reject' | 'revision' | null>(null);
  const [reason, setReason] = useState('');
  const [decideError, setDecideError] = useState<string | null>(null);

  const { data: item, error, isLoading, refetch } = useQuery({
    queryKey: ['review-queue-item', id],
    queryFn: () => reviewQueueApi.get(id!),
    enabled: !!id,
  });

  const decideMutation = useMutation({
    mutationFn: (vars: { decision: 'approved' | 'rejected' | 'revision_requested'; reason?: string }) =>
      reviewQueueApi.decide(id!, vars),
    onSuccess: () => {
      setDecideError(null);
      queryClient.invalidateQueries({ queryKey: ['review-queue-item', id] });
      queryClient.invalidateQueries({ queryKey: ['review-queue'] });
    },
    onError: (err) => {
      if (isAxiosError(err) && err.response?.data?.error?.code === 'ALREADY_DECIDED') {
        setDecideError('Este item ja foi decidido anteriormente.');
        queryClient.invalidateQueries({ queryKey: ['review-queue-item', id] });
        return;
      }
      setDecideError(
        isAxiosError(err) && err.response?.data?.error?.message
          ? err.response.data.error.message
          : 'Nao foi possivel registrar a decisao.',
      );
    },
  });

  if (isLoading) return <Spinner />;
  if (error || !item) {
    return (
      <div className="mx-auto max-w-2xl space-y-3">
        <Alert variant="error">
          Nao foi possivel carregar este item da fila de revisao agora. O conteudo permanece bloqueado e nao
          publicado enquanto isso.
        </Alert>
        <Button size="sm" variant="outline" onClick={() => refetch()}>
          Tentar novamente
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>{item.campaign_name}</CardTitle>
            <CardDescription>Criador: {item.creator_display_name}</CardDescription>
          </div>
          <Badge variant={STATUS_BADGE[item.status]}>{STATUS_LABEL[item.status]}</Badge>
        </div>
      </CardHeader>

      <Card>
        <h3 className="text-sm font-semibold text-text-dark mb-3">Conteudo submetido</h3>
        <div className="space-y-3 text-sm text-text-dark">
          <div>
            <p className="text-xs font-semibold text-muted uppercase">Legenda</p>
            <p className="font-mono">{item.caption_text}</p>
          </div>
          {item.on_screen_text && (
            <div>
              <p className="text-xs font-semibold text-muted uppercase">Texto na tela</p>
              <p className="font-mono">{item.on_screen_text}</p>
            </div>
          )}
          {item.audio_transcript && (
            <div>
              <p className="text-xs font-semibold text-muted uppercase">Transcricao de audio</p>
              <p className="font-mono">{item.audio_transcript}</p>
            </div>
          )}
        </div>
        {item.tier_reached && (
          <p className="font-mono text-xs text-muted mt-3">Verificacao resolvida em: {item.tier_reached}</p>
        )}
      </Card>

      <Card>
        <h3 className="text-sm font-semibold text-text-dark mb-3">
          {item.reason_category === 'check_unavailable' ? 'Verificacao nao pode ser concluida' : 'Regras violadas'}
        </h3>
        <ul className="space-y-2">
          {item.triggered_rules.map((rule, i) => (
            <li key={i} className="font-mono text-xs text-text-dark bg-surface rounded px-3 py-2">
              <p className="font-semibold">
                {CHANNEL_LABEL[rule.channel] ?? rule.channel}
                {rule.rule_type && ` · ${rule.rule_type}`}
              </p>
              {rule.matched_excerpt && <p className="text-muted mt-1">"{rule.matched_excerpt}"</p>}
              {rule.definition && <p className="text-muted mt-1">{JSON.stringify(rule.definition)}</p>}
            </li>
          ))}
        </ul>
      </Card>

      {item.status === 'pending' && canDecide && (
        <Card>
          <h3 className="text-sm font-semibold text-text-dark mb-3">Decisao</h3>
          {decideError && (
            <Alert variant="error" className="mb-3">
              {decideError}
            </Alert>
          )}
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
        </Card>
      )}

      {item.status !== 'pending' && (
        <Card>
          <h3 className="text-sm font-semibold text-text-dark mb-2">Decisao registrada</h3>
          <p className="text-sm text-text-dark">Status: {STATUS_LABEL[item.status]}</p>
          {item.decided_at && (
            <p className="font-mono text-xs text-muted mt-1">{new Date(item.decided_at).toLocaleString('pt-BR')}</p>
          )}
          {item.decision_reason && <p className="text-sm text-muted mt-2">Motivo: {item.decision_reason}</p>}
        </Card>
      )}

      <Button variant="ghost" size="sm" onClick={() => navigate('/app/safety/review-queue')}>
        Voltar para a fila
      </Button>
    </div>
  );
}
