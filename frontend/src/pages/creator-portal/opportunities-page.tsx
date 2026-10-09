import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { creatorPortalApi, getCreatorToken } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import type { CreatorOpportunity, OpportunityStatus } from '@/types/api';

/** Small colored data point used as a motif accent next to a metric, on a thin grid line. */
function MetricDot({ color }: { color: string }) {
  return <span className="inline-block h-2 w-2 rounded-full mr-2" style={{ backgroundColor: color }} />;
}

function formatCurrency(amount: string) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(amount));
}

const STATUS_BADGE: Record<OpportunityStatus, 'default' | 'success' | 'warning' | 'error'> = {
  pending: 'warning',
  accepted: 'success',
  declined: 'default',
  expired: 'error',
};

const STATUS_LABEL: Record<OpportunityStatus, string> = {
  pending: 'Pendente',
  accepted: 'Aceita',
  declined: 'Recusada',
  expired: 'Expirada',
};

function ExpiryCountdown({ expiresAt }: { expiresAt: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);
  const remainingMs = new Date(expiresAt).getTime() - now;
  if (remainingMs <= 0) return <span className="font-mono text-xs text-error">Expirada</span>;
  const hours = Math.floor(remainingMs / 3_600_000);
  const minutes = Math.floor((remainingMs % 3_600_000) / 60_000);
  return (
    <span className="font-mono text-xs text-muted">
      Expira em {hours}h {minutes}min
    </span>
  );
}

function OpportunityCard({ opportunity }: { opportunity: CreatorOpportunity }) {
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);

  const acceptMutation = useMutation({
    mutationFn: () => creatorPortalApi.accept(opportunity.id),
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ['creator-opportunities'] });
    },
    onError: (err) => {
      setActionError(
        isAxiosError(err) && err.response?.data?.error?.code === 'OPPORTUNITY_EXPIRED'
          ? 'Esta oportunidade expirou antes do seu aceite.'
          : 'Nao foi possivel aceitar a oportunidade agora.',
      );
      queryClient.invalidateQueries({ queryKey: ['creator-opportunities'] });
    },
  });

  const declineMutation = useMutation({
    mutationFn: () => creatorPortalApi.decline(opportunity.id),
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ['creator-opportunities'] });
    },
    onError: () => setActionError('Nao foi possivel recusar a oportunidade agora.'),
  });

  const isPending = opportunity.status === 'pending';

  return (
    <Card>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-text-dark">{opportunity.brand_name}</h3>
          <p className="text-xs text-muted mt-0.5">
            {opportunity.deliverable.format} &middot; {opportunity.deliverable.quantity}x
          </p>
        </div>
        <Badge variant={STATUS_BADGE[opportunity.status]}>{STATUS_LABEL[opportunity.status]}</Badge>
      </div>

      <div className="mt-4 space-y-1.5 border-t border-border pt-3">
        <p className="flex items-center font-mono text-sm text-text-dark">
          <MetricDot color="var(--color-signal-green)" />
          Pagamento bruto: {formatCurrency(opportunity.payout_gross)}
        </p>
        <p className="flex items-center font-mono text-sm text-text-dark">
          <MetricDot color="var(--color-performance-orange)" />
          Comissao: {formatCurrency(opportunity.payout_commission)}
        </p>
        <p className="flex items-center font-mono text-sm text-text-dark">
          <MetricDot color="var(--color-creator-pink)" />
          Pagamento liquido: {formatCurrency(opportunity.payout_net)}
        </p>
      </div>

      {isPending && (
        <div className="mt-3">
          <ExpiryCountdown expiresAt={opportunity.expires_at} />
        </div>
      )}

      {actionError && (
        <Alert variant="error" className="mt-3">
          {actionError}
        </Alert>
      )}

      {isPending && (
        <div className="mt-4 flex gap-2">
          <Button size="sm" onClick={() => acceptMutation.mutate()} loading={acceptMutation.isPending}>
            Aceitar
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => declineMutation.mutate()}
            loading={declineMutation.isPending}
          >
            Recusar
          </Button>
        </div>
      )}
    </Card>
  );
}

export function OpportunitiesPage() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!getCreatorToken()) {
      navigate('/creator-portal/access');
    }
  }, [navigate]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['creator-opportunities'],
    queryFn: () => creatorPortalApi.listOpportunities(),
    refetchInterval: 60_000,
  });

  if (isLoading) return <Spinner />;
  if (error) return <Alert variant="error">Nao foi possivel carregar suas oportunidades.</Alert>;

  const opportunities = data?.data ?? [];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <CardHeader>
        <CardTitle>Suas oportunidades</CardTitle>
        <CardDescription>Revise cada oportunidade e escolha aceitar ou recusar antes do prazo.</CardDescription>
      </CardHeader>

      {opportunities.length === 0 ? (
        <Card>
          <p className="text-sm text-muted py-6 text-center">Nenhuma oportunidade no momento.</p>
        </Card>
      ) : (
        <div className="space-y-4">
          {opportunities.map((opp) => (
            <OpportunityCard key={opp.id} opportunity={opp} />
          ))}
        </div>
      )}
    </div>
  );
}
