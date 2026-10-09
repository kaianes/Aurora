import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { campaignApi } from '@/lib/api-client';
import { useAuth } from '@/contexts/auth-context';
import { canWriteCampaign } from '@/lib/roles';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import type { CampaignState } from '@/types/api';

const STATE_LABELS: Record<CampaignState, string> = {
  draft: 'Rascunho',
  quoted: 'Cotado',
  confirmed: 'Confirmado',
  active: 'Ativo',
  paused: 'Pausado',
  completed: 'Concluido',
  cancelled: 'Cancelado',
};

const STATE_BADGE: Record<CampaignState, 'default' | 'success' | 'warning' | 'error' | 'primary'> = {
  draft: 'default',
  quoted: 'primary',
  confirmed: 'primary',
  active: 'success',
  paused: 'warning',
  completed: 'success',
  cancelled: 'error',
};

function formatCurrency(amount?: string | null) {
  if (!amount) return '-';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(amount));
}

function formatNumber(n?: number) {
  if (n === undefined) return '-';
  return new Intl.NumberFormat('pt-BR').format(n);
}

/** Small colored data point used as a motif accent next to a metric, on a thin grid line. */
function MetricDot({ color }: { color: string }) {
  return <span className="inline-block h-2 w-2 rounded-full mr-2" style={{ backgroundColor: color }} />;
}

interface BoundsForm {
  enabled: boolean;
  max_shift_pct: string;
  min_guaranteed_share_pct: string;
}

export function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { currentRole } = useAuth();
  const canWrite = currentRole ? canWriteCampaign(currentRole) : false;
  const [lifecycleReason, setLifecycleReason] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [boundsError, setBoundsError] = useState<string | null>(null);

  const { data: campaign, isLoading, error } = useQuery({
    queryKey: ['campaign', id],
    queryFn: () => campaignApi.get(id!),
    enabled: !!id,
  });

  const pendingQuoteId = campaign?.latest_quote?.status === 'pending' ? campaign.latest_quote.id : null;

  const { data: polledQuote } = useQuery({
    queryKey: ['campaign-quote', id, pendingQuoteId],
    queryFn: () => campaignApi.getQuote(id!, pendingQuoteId!),
    enabled: !!id && !!pendingQuoteId,
    refetchInterval: (query) => (query.state.data?.status === 'pending' ? 2000 : false),
  });

  const quote = polledQuote ?? campaign?.latest_quote ?? null;

  // Refresh the campaign once the quote resolves, so state (draft -> quoted) catches up.
  const quoteJustResolved = polledQuote && polledQuote.status !== 'pending';
  useEffect(() => {
    if (quoteJustResolved) {
      queryClient.invalidateQueries({ queryKey: ['campaign', id] });
    }
  }, [quoteJustResolved, id, queryClient]);

  const { data: shortfallData } = useQuery({
    queryKey: ['campaign-shortfall', id],
    queryFn: () => campaignApi.getShortfall(id!),
    enabled: !!id && (campaign?.state === 'confirmed' || campaign?.state === 'active' || campaign?.state === 'paused'),
  });

  const { data: reallocationEvents } = useQuery({
    queryKey: ['reallocation-events', id],
    queryFn: () => campaignApi.listReallocationEvents(id!),
    enabled: !!id && (campaign?.state === 'active' || campaign?.state === 'paused'),
  });

  const requestQuoteMutation = useMutation({
    mutationFn: () => campaignApi.requestQuote(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaign', id] });
    },
  });

  const confirmMutation = useMutation({
    mutationFn: () => campaignApi.confirm(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaign', id] });
    },
  });

  const pauseMutation = useMutation({
    mutationFn: () => campaignApi.pause(id!, { reason: lifecycleReason || undefined }),
    onSuccess: () => {
      setLifecycleReason('');
      queryClient.invalidateQueries({ queryKey: ['campaign', id] });
    },
  });

  const resumeMutation = useMutation({
    mutationFn: () => campaignApi.resume(id!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['campaign', id] }),
  });

  const cancelMutation = useMutation({
    mutationFn: () => campaignApi.cancel(id!, { reason: lifecycleReason || undefined }),
    onSuccess: () => {
      setLifecycleReason('');
      queryClient.invalidateQueries({ queryKey: ['campaign', id] });
    },
  });

  const saveTemplateMutation = useMutation({
    mutationFn: () => campaignApi.saveAsTemplate(id!, { name: templateName }),
    onSuccess: () => {
      setTemplateName('');
      navigate('/app/templates');
    },
  });

  const {
    register: registerBounds,
    handleSubmit: handleBoundsSubmit,
  } = useForm<BoundsForm>({
    defaultValues: { enabled: false, max_shift_pct: '20', min_guaranteed_share_pct: '50' },
  });

  const boundsMutation = useMutation({
    mutationFn: (data: BoundsForm) =>
      campaignApi.setReallocationBounds(id!, {
        enabled: data.enabled,
        max_shift_pct: Number(data.max_shift_pct),
        min_guaranteed_share_pct: Number(data.min_guaranteed_share_pct),
      }),
    onSuccess: () => {
      setBoundsError(null);
      queryClient.invalidateQueries({ queryKey: ['campaign', id] });
    },
    onError: (err) => {
      setBoundsError(
        isAxiosError(err) && err.response?.data?.error?.message
          ? err.response.data.error.message
          : 'Nao foi possivel salvar os limites de realocacao.',
      );
    },
  });

  const onBoundsSubmit = (data: BoundsForm) => {
    // Client-side bounds validation, mirroring ADR-0007 server-side ranges.
    const maxShift = Number(data.max_shift_pct);
    const minShare = Number(data.min_guaranteed_share_pct);
    if (Number.isNaN(maxShift) || maxShift < 0 || maxShift > 30) {
      setBoundsError('O deslocamento maximo deve estar entre 0% e 30%.');
      return;
    }
    if (Number.isNaN(minShare) || minShare < 40 || minShare > 100) {
      setBoundsError('A participacao minima garantida deve estar entre 40% e 100%.');
      return;
    }
    boundsMutation.mutate(data);
  };

  const quoteRequiredMissing = (campaign?.missing_fields ?? []).filter((f) =>
    ['budget_amount', 'audience_targeting', 'message', 'deliverable_formats'].includes(f),
  );

  if (isLoading) return <Spinner />;
  if (error || !campaign) return <Alert variant="error">Nao foi possivel carregar a campanha.</Alert>;

  const lifecycleError = pauseMutation.error ?? resumeMutation.error ?? cancelMutation.error;
  const lifecycleErrorMessage =
    lifecycleError && isAxiosError(lifecycleError) && lifecycleError.response?.data?.error?.message
      ? lifecycleError.response.data.error.message
      : lifecycleError
        ? 'Nao foi possivel executar essa acao no estado atual.'
        : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>{campaign.name}</CardTitle>
            <CardDescription>Criada em {new Date(campaign.created_at).toLocaleDateString('pt-BR')}</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={STATE_BADGE[campaign.state]}>{STATE_LABELS[campaign.state]}</Badge>
            {canWrite && campaign.state === 'draft' && (
              <Link to={`/app/campaigns/${campaign.id}/edit`}>
                <Button variant="outline" size="sm">Editar</Button>
              </Link>
            )}
          </div>
        </div>
      </CardHeader>

      {campaign.brand_profile_drift && campaign.brand_profile_drift.length > 0 && (
        <Alert variant="warning">
          Este modelo usa configuracoes do perfil de marca que mudaram: {campaign.brand_profile_drift.join(', ')}.
          Confirme ou atualize antes de cotar.
        </Alert>
      )}

      {/* Draft: quote-readiness and request */}
      {campaign.state === 'draft' && (
        <Card>
          <h3 className="text-sm font-semibold text-text-dark mb-3">Cotacao</h3>
          {quoteRequiredMissing.length > 0 ? (
            <Alert variant="warning">
              Complete os campos pendentes antes de solicitar uma cotacao: {quoteRequiredMissing.join(', ')}.
            </Alert>
          ) : (
            <Button
              onClick={() => requestQuoteMutation.mutate()}
              loading={requestQuoteMutation.isPending}
              disabled={!canWrite}
            >
              Solicitar cotacao
            </Button>
          )}
          {requestQuoteMutation.error && (
            <Alert variant="error" className="mt-3">
              {isAxiosError(requestQuoteMutation.error) && requestQuoteMutation.error.response?.data?.error?.message
                ? requestQuoteMutation.error.response.data.error.message
                : 'Nao foi possivel solicitar a cotacao.'}
            </Alert>
          )}
        </Card>
      )}

      {/* Quote in progress / result */}
      {quote && (
        <Card>
          <h3 className="text-sm font-semibold text-text-dark mb-3">Cotacao da campanha</h3>

          {quote.status === 'pending' && (
            <div className="flex items-center gap-3 text-sm text-muted">
              <Spinner className="h-5 w-5" />
              Calculando pool, alcance e preco. Isso pode levar alguns segundos.
            </div>
          )}

          {quote.status === 'ready' && (
            <div className="space-y-2 border-t border-border pt-3">
              <p className="flex items-center font-mono text-sm text-text-dark">
                <MetricDot color="var(--color-creator-pink)" />
                Pool minimo garantido: {formatNumber(quote.guaranteed_min_pool_size)} criadores
              </p>
              <p className="flex items-center font-mono text-sm text-text-dark">
                <MetricDot color="var(--color-signal-green)" />
                Alcance projetado: {formatNumber(quote.projected_reach_low)} - {formatNumber(quote.projected_reach_high)}
              </p>
              <p className="flex items-center font-mono text-sm text-text-dark">
                <MetricDot color="var(--color-strategy-violet)" />
                Preco total: {formatCurrency(quote.total_price)}
              </p>
              {campaign.state === 'quoted' && canWrite && (
                <div className="pt-3">
                  <Button onClick={() => confirmMutation.mutate()} loading={confirmMutation.isPending}>
                    Confirmar compra
                  </Button>
                </div>
              )}
              {confirmMutation.error && (
                <Alert variant="error">
                  {isAxiosError(confirmMutation.error) && confirmMutation.error.response?.data?.error?.message
                    ? confirmMutation.error.response.data.error.message
                    : 'Nao foi possivel confirmar a campanha.'}
                </Alert>
              )}
            </div>
          )}

          {quote.status === 'no_viable_pool' && (
            <Alert variant="warning">{quote.failure_reason ?? 'Nenhum pool viavel para esta combinacao de publico.'}</Alert>
          )}

          {quote.status === 'failed' && (
            <div className="space-y-3">
              <Alert variant="error">{quote.failure_reason ?? 'Nao foi possivel calcular a cotacao agora.'}</Alert>
              {canWrite && (
                <Button variant="outline" size="sm" onClick={() => requestQuoteMutation.mutate()} loading={requestQuoteMutation.isPending}>
                  Tentar novamente
                </Button>
              )}
            </div>
          )}
        </Card>
      )}

      {/* Shortfall notice */}
      {shortfallData?.shortfall && !shortfallData.shortfall.resolved_at && (
        <Alert variant="warning">
          O pool garantido nao pode ser totalmente preenchido antes do lancamento.{' '}
          <Link to={`/app/campaigns/${campaign.id}/shortfall`} className="underline font-medium">
            Resolver agora
          </Link>
        </Alert>
      )}

      {/* Locked price once confirmed+ */}
      {['confirmed', 'active', 'paused', 'completed', 'cancelled'].includes(campaign.state) && campaign.latest_quote && (
        <Card>
          <h3 className="text-sm font-semibold text-text-dark mb-2">Preco travado</h3>
          <p className="font-mono text-2xl text-text-dark">{formatCurrency(campaign.latest_quote.total_price)}</p>
          <p className="text-xs text-muted mt-1">
            Esse valor nao muda, independente da variacao de custo por criador durante a execucao.
          </p>
        </Card>
      )}

      {/* Lifecycle controls */}
      {canWrite && ['active', 'paused', 'confirmed'].includes(campaign.state) && (
        <Card>
          <h3 className="text-sm font-semibold text-text-dark mb-3">Controles da campanha</h3>
          {lifecycleErrorMessage && <Alert variant="error" className="mb-3">{lifecycleErrorMessage}</Alert>}
          <Input
            label="Motivo (opcional)"
            value={lifecycleReason}
            onChange={(e) => setLifecycleReason(e.target.value)}
            placeholder="Ex: incidente de imagem da marca"
            className="mb-3"
          />
          <div className="flex gap-2">
            {campaign.state === 'active' && (
              <Button variant="secondary" onClick={() => pauseMutation.mutate()} loading={pauseMutation.isPending}>
                Pausar
              </Button>
            )}
            {campaign.state === 'paused' && (
              <Button onClick={() => resumeMutation.mutate()} loading={resumeMutation.isPending}>
                Retomar
              </Button>
            )}
            {['active', 'paused', 'confirmed'].includes(campaign.state) && (
              <Button variant="danger" onClick={() => cancelMutation.mutate()} loading={cancelMutation.isPending}>
                Cancelar
              </Button>
            )}
          </div>
        </Card>
      )}

      {/* Reallocation bounds + history */}
      {['confirmed', 'active', 'paused'].includes(campaign.state) && (
        <Card>
          <h3 className="text-sm font-semibold text-text-dark mb-3">Realocacao automatica de orcamento</h3>
          <p className="text-xs text-muted mb-3">
            Desativada por padrao. Ative para que o orcamento ainda nao comprometido migre para os criadores com
            melhor desempenho, dentro dos limites abaixo.
          </p>
          {boundsError && <Alert variant="error" className="mb-3">{boundsError}</Alert>}
          <form onSubmit={handleBoundsSubmit(onBoundsSubmit)} className="space-y-3" noValidate>
            <label className="flex items-center gap-2 text-sm text-text-dark">
              <input type="checkbox" {...registerBounds('enabled')} disabled={!canWrite} />
              Ativar realocacao automatica
            </label>
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Deslocamento maximo por ciclo (%)"
                type="number"
                min={0}
                max={30}
                hint="0 a 30"
                {...registerBounds('max_shift_pct')}
                disabled={!canWrite}
              />
              <Input
                label="Participacao minima garantida (%)"
                type="number"
                min={40}
                max={100}
                hint="40 a 100"
                {...registerBounds('min_guaranteed_share_pct')}
                disabled={!canWrite}
              />
            </div>
            {canWrite && (
              <Button type="submit" variant="outline" size="sm" loading={boundsMutation.isPending}>
                Salvar limites
              </Button>
            )}
          </form>

          {reallocationEvents && reallocationEvents.data.length > 0 && (
            <div className="mt-5 border-t border-border pt-4">
              <h4 className="text-xs font-semibold text-muted uppercase mb-2">Historico de realocacao</h4>
              <div className="space-y-2">
                {reallocationEvents.data.map((ev) => (
                  <div key={ev.id} className="flex items-center justify-between text-sm">
                    <span className="flex items-center font-mono text-xs text-muted">
                      <MetricDot
                        color={
                          ev.outcome === 'applied' ? 'var(--color-performance-orange)' : 'var(--color-strategy-violet)'
                        }
                      />
                      {new Date(ev.created_at).toLocaleString('pt-BR')}
                    </span>
                    <Badge variant={ev.outcome === 'applied' ? 'success' : 'default'}>
                      {ev.outcome === 'applied'
                        ? 'Aplicada'
                        : ev.outcome === 'skipped_stale_metrics'
                          ? 'Pulada (metricas indisponiveis)'
                          : 'Pulada (sem dados)'}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Save as template */}
      {canWrite && ['confirmed', 'active', 'paused', 'completed', 'cancelled'].includes(campaign.state) && (
        <Card>
          <h3 className="text-sm font-semibold text-text-dark mb-3">Salvar como modelo</h3>
          <div className="flex gap-2">
            <Input
              label="Nome do modelo"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              className="flex-1"
            />
            <Button
              className="self-end"
              onClick={() => saveTemplateMutation.mutate()}
              loading={saveTemplateMutation.isPending}
              disabled={!templateName}
            >
              Salvar
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
