import { useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { shortlistApi } from '@/lib/api-client';
import { useAuth } from '@/contexts/auth-context';
import { canDecideShortlist } from '@/lib/roles';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import type { ShortlistEntry, ShortlistEntryDecision } from '@/types/api';

/** Small colored data point used as a motif accent next to a metric, on a thin grid line. */
function MetricDot({ color }: { color: string }) {
  return <span className="inline-block h-2 w-2 rounded-full mr-2" style={{ backgroundColor: color }} />;
}

const DECISION_BADGE: Record<ShortlistEntryDecision, 'default' | 'success' | 'error'> = {
  pending: 'default',
  approved: 'success',
  rejected: 'error',
};

const DECISION_LABEL: Record<ShortlistEntryDecision, string> = {
  pending: 'Pendente',
  approved: 'Aprovado',
  rejected: 'Rejeitado',
};

export function ShortlistPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { currentRole } = useAuth();
  const canDecide = currentRole ? canDecideShortlist(currentRole) : false;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: shortlist, isLoading, error } = useQuery({
    queryKey: ['shortlist', id],
    queryFn: () => shortlistApi.get(id!),
    enabled: !!id,
    refetchInterval: (query) => (query.state.data?.status === 'pending' ? 2000 : false),
  });

  const requestMutation = useMutation({
    mutationFn: () => shortlistApi.request(id!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['shortlist', id] }),
    onError: (err) => {
      setActionError(
        isAxiosError(err) && err.response?.data?.error?.message
          ? err.response.data.error.message
          : 'Não foi possível gerar o shortlist agora.',
      );
    },
  });

  const decideMutation = useMutation({
    mutationFn: ({ entryId, decision }: { entryId: string; decision: 'approved' | 'rejected' }) =>
      shortlistApi.decide(id!, entryId, { decision }),
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ['shortlist', id] });
    },
    onError: (err) => {
      setActionError(
        isAxiosError(err) && err.response?.data?.error?.message
          ? err.response.data.error.message
          : 'Não foi possível registrar a decisão. Se a campanha ja estiver ativa, o shortlist esta bloqueado.',
      );
    },
  });

  const bulkMutation = useMutation({
    mutationFn: (decision: 'approved' | 'rejected') =>
      shortlistApi.bulkDecide(id!, {
        decisions: Array.from(selected).map((entry_id) => ({ entry_id, decision })),
      }),
    onSuccess: () => {
      setActionError(null);
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ['shortlist', id] });
    },
    onError: (err) => {
      setActionError(
        isAxiosError(err) && err.response?.data?.error?.message
          ? err.response.data.error.message
          : 'Não foi possível aplicar a decisão em lote.',
      );
    },
  });

  const requestMoreMutation = useMutation({
    mutationFn: () => shortlistApi.requestAdditionalCandidates(id!),
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ['shortlist', id] });
    },
    onError: (err) => {
      setActionError(
        isAxiosError(err) && err.response?.data?.error?.message
          ? err.response.data.error.message
          : 'Não foi possível solicitar mais candidatos.',
      );
    },
  });

  const toggleSelected = (entryId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
  };

  if (isLoading) return <Spinner />;
  if (error) return <Alert variant="error">Não foi possível carregar o shortlist.</Alert>;

  const locked = shortlist?.locked ?? false;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex justify-end"><Button variant="ghost" size="sm" onClick={() => navigate(`/app/campaigns/${id}`)}>Voltar para a campanha</Button></div>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Shortlist de criadores</CardTitle>
            <CardDescription>Criadores ranqueados por adequacao a campanha.</CardDescription>
          </div>
          {canDecide && shortlist && !locked && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => requestMutation.mutate()}
              loading={requestMutation.isPending}
            >
              {shortlist.status === 'ready' ? 'Gerar novamente' : 'Gerar shortlist'}
            </Button>
          )}
        </div>
      </CardHeader>

      {actionError && <Alert variant="error">{actionError}</Alert>}

      {!shortlist && canDecide && (
        <Card>
          <p className="text-sm text-text-secondary mb-3">Nenhum shortlist gerado ainda para esta campanha.</p>
          <Button onClick={() => requestMutation.mutate()} loading={requestMutation.isPending}>
            Gerar shortlist
          </Button>
        </Card>
      )}

      {shortlist?.status === 'pending' && (
        <Card>
          <div className="flex items-center gap-3 text-sm text-text-secondary">
            <Spinner className="h-5 w-5" />
            Gerando shortlist. Isso pode levar até 60 segundos.
          </div>
        </Card>
      )}

      {shortlist?.status === 'failed' && (
        <Alert variant="error">
          {shortlist.failure_reason ?? 'Não foi possível gerar o shortlist agora. Tente novamente.'}
        </Alert>
      )}

      {shortlist?.status === 'no_viable_pool' && (
        <Alert variant="warning">
          {shortlist.failure_reason ?? 'Nenhum criador elegivel foi encontrado para esta combinacao de publico.'}
        </Alert>
      )}

      {shortlist?.status === 'ready' && (
        <>
          {shortlist.below_guaranteed_minimum && (
            <Alert variant="warning">
              O pool aprovado esta abaixo do minimo garantido
              {shortlist.guaranteed_min_pool_size !== undefined && shortlist.matched_count !== undefined
                ? ` (${shortlist.matched_count} de ${shortlist.guaranteed_min_pool_size} criadores).`
                : '.'}{' '}
              {canDecide && !locked && (
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-2"
                  onClick={() => requestMoreMutation.mutate()}
                  loading={requestMoreMutation.isPending}
                >
                  Solicitar mais candidatos
                </Button>
              )}
            </Alert>
          )}

          {locked && (
            <Alert variant="info">
              Shortlist bloqueado
              {shortlist.locked_reason === 'campaign_activated'
                ? ' porque a campanha ja esta ativa. Use os controles da campanha para novas mudancas.'
                : shortlist.locked_reason === 'agency_override'
                  ? ' porque a agencia salvou uma selecao curada (override).'
                  : '.'}
            </Alert>
          )}

          {canDecide && !locked && selected.size > 0 && (
            <Card>
              <div className="flex items-center justify-between">
                <p className="text-sm text-text-primary">{selected.size} criador(es) selecionado(s)</p>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => bulkMutation.mutate('approved')} loading={bulkMutation.isPending}>
                    Aprovar selecionados
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => bulkMutation.mutate('rejected')}
                    loading={bulkMutation.isPending}
                  >
                    Rejeitar selecionados
                  </Button>
                </div>
              </div>
            </Card>
          )}

          <Card>
            <div className="divide-y divide-border">
              {shortlist.entries.map((entry: ShortlistEntry) => (
                <div key={entry.id} className="flex items-center justify-between py-3 gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    {canDecide && !locked && (
                      <input
                        type="checkbox"
                        checked={selected.has(entry.id)}
                        onChange={() => toggleSelected(entry.id)}
                        aria-label={`Selecionar criador ${entry.creator_id}`}
                      />
                    )}
                    <div className="min-w-0">
                      <Link
                        to={`/app/campaigns/${id}/shortlist/creators/${entry.creator_id}`}
                        className="text-sm font-medium text-violet-400 hover:underline"
                      >
                        {entry.creator_display_name ?? entry.creator_id}
                      </Link>
                      <p className="flex items-center font-mono text-xs text-text-secondary mt-0.5">
                        {entry.rank !== null && (
                          <>
                            <MetricDot color="var(--color-strategy-violet)" />
                            Rank #{entry.rank}
                            {entry.fit_score !== null && ` · fit ${(entry.fit_score * 100).toFixed(0)}%`}
                          </>
                        )}
                        {entry.origin === 'agency_added' && (
                          <>
                            <MetricDot color="var(--color-creator-pink)" />
                            Adicionado pela agencia
                          </>
                        )}
                      </p>
                      {entry.matched_attributes.length > 0 && (
                        <p className="text-xs text-text-secondary mt-1">{entry.matched_attributes.join(', ')}</p>
                      )}
                      {/* E10 US-10.2: fit reason from Claude. Null for agency-added entries
                          (origin=agency_added has fit_reason=null, fit_reason_unavailable=false
                          by design -- no Claude call is made for those). */}
                      {entry.fit_reason && (
                        <p className="text-xs text-text-secondary mt-1.5 italic max-w-sm leading-snug">
                          <span
                            className="not-italic mr-1 font-semibold"
                            style={{ color: 'var(--color-strategy-violet)' }}
                            aria-hidden="true"
                          >
                            ✦
                          </span>
                          {entry.fit_reason}
                        </p>
                      )}
                      {!entry.fit_reason && entry.fit_reason_unavailable && (
                        <p className="text-xs text-text-muted mt-1.5 italic">
                          Justificativa nao disponivel.
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant={DECISION_BADGE[entry.decision]}>{DECISION_LABEL[entry.decision]}</Badge>
                    {!entry.included && <Badge variant="default">Fora do pool</Badge>}
                    {canDecide && !locked && (
                      <>
                        <Button
                          size="sm"
                          variant={entry.decision === 'approved' ? 'primary' : 'outline'}
                          onClick={() => decideMutation.mutate({ entryId: entry.id, decision: 'approved' })}
                          loading={decideMutation.isPending}
                        >
                          Aprovar
                        </Button>
                        <Button
                          size="sm"
                          variant={entry.decision === 'rejected' ? 'danger' : 'outline'}
                          onClick={() => decideMutation.mutate({ entryId: entry.id, decision: 'rejected' })}
                          loading={decideMutation.isPending}
                        >
                          Rejeitar
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
              {shortlist.entries.length === 0 && (
                <p className="text-sm text-text-secondary py-8 text-center">Nenhum criador no shortlist.</p>
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
