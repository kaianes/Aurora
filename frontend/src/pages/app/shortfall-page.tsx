import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { campaignApi } from '@/lib/api-client';
import { useAuth } from '@/contexts/auth-context';
import { canResolveShortfall } from '@/lib/roles';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import type { ResolveShortfallRequest } from '@/types/api';

function formatCurrency(amount: string | null) {
  if (!amount) return '-';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(amount));
}

export function ShortfallPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { currentRole } = useAuth();
  const canResolve = currentRole ? canResolveShortfall(currentRole) : false;
  const [choice, setChoice] = useState<ResolveShortfallRequest['resolution_type'] | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['campaign-shortfall', id],
    queryFn: () => campaignApi.getShortfall(id!),
    enabled: !!id,
  });

  const resolveMutation = useMutation({
    mutationFn: (resolution_type: ResolveShortfallRequest['resolution_type']) =>
      campaignApi.resolveShortfall(id!, { resolution_type }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaign-shortfall', id] });
      navigate(`/app/campaigns/${id}`);
    },
  });

  if (isLoading) return <Spinner />;
  if (error) return <Alert variant="error">Nao foi possivel carregar o status do pool.</Alert>;

  const shortfall = data?.shortfall;

  if (!shortfall) {
    return (
      <div className="mx-auto max-w-2xl">
        <Alert variant="success">O pool minimo garantido foi atendido. Nenhuma acao necessaria.</Alert>
      </div>
    );
  }

  // choice_offered reflects ADR-0008's 15% threshold at the time the shortfall was recorded;
  // chosen_by only becomes 'buyer' after resolution, so it can't be used to gate the choice UI.
  const offersChoice = shortfall.choice_offered && !shortfall.resolved_at;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <CardHeader>
        <CardTitle>Pool abaixo do minimo garantido</CardTitle>
        <CardDescription>
          Nao foi possivel preencher o pool minimo garantido antes do lancamento. Veja abaixo a resolucao.
        </CardDescription>
      </CardHeader>

      <Card>
        {shortfall.resolution_type === 'partial_refund' ? (
          <p className="font-mono text-sm text-text-dark">
            Reembolso parcial: {formatCurrency(shortfall.refund_amount)}
          </p>
        ) : (
          <p className="font-mono text-sm text-text-dark">
            Garantia revisada: {shortfall.revised_min_pool_size} criadores
          </p>
        )}
        <p className="text-xs text-muted mt-2 font-mono">
          Notificado em {new Date(shortfall.notified_at).toLocaleString('pt-BR')}
        </p>

        {shortfall.resolved_at ? (
          <Alert variant="success" className="mt-4">
            Resolucao confirmada em {new Date(shortfall.resolved_at).toLocaleString('pt-BR')}.
          </Alert>
        ) : offersChoice ? (
          canResolve ? (
            <div className="mt-4 space-y-3">
              <p className="text-sm text-text-dark">Escolha como deseja proceder:</p>
              <div className="flex gap-2">
                <Button
                  variant={choice === 'partial_refund' ? 'primary' : 'outline'}
                  onClick={() => setChoice('partial_refund')}
                >
                  Reembolso parcial
                </Button>
                <Button
                  variant={choice === 'revised_guarantee' ? 'primary' : 'outline'}
                  onClick={() => setChoice('revised_guarantee')}
                >
                  Garantia revisada
                </Button>
              </div>
              <Button
                disabled={!choice}
                loading={resolveMutation.isPending}
                onClick={() => choice && resolveMutation.mutate(choice)}
              >
                Confirmar escolha
              </Button>
              {resolveMutation.error && (
                <Alert variant="error">
                  {isAxiosError(resolveMutation.error) && resolveMutation.error.response?.data?.error?.message
                    ? resolveMutation.error.response.data.error.message
                    : 'Nao foi possivel registrar a resolucao.'}
                </Alert>
              )}
            </div>
          ) : (
            <Alert variant="warning" className="mt-4">
              Apenas o proprietario da marca ou administrador da agencia pode escolher a resolucao.
            </Alert>
          )
        ) : (
          canResolve && (
            <div className="mt-4">
              <Button
                loading={resolveMutation.isPending}
                onClick={() => resolveMutation.mutate(shortfall.resolution_type)}
              >
                Confirmar
              </Button>
            </div>
          )
        )}
      </Card>
    </div>
  );
}
