import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { campaignApi } from '@/lib/api-client';
import { useAuth } from '@/contexts/auth-context';
import { canWriteCampaign } from '@/lib/roles';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { Alert } from '@/components/ui/alert';
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

function formatCurrency(amount: string | null) {
  if (!amount) return '-';
  const value = Number(amount);
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

export function CampaignsPage() {
  const { currentRole } = useAuth();
  const canCreate = currentRole ? canWriteCampaign(currentRole) : false;

  const { data, isLoading, error } = useQuery({
    queryKey: ['campaigns'],
    queryFn: () => campaignApi.list({ limit: 50 }),
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Campanhas</CardTitle>
            <CardDescription>Defina, cote e acompanhe suas campanhas de pool de criadores.</CardDescription>
          </div>
          {canCreate && (
            <Link to="/app/campaigns/new">
              <Button>Nova campanha</Button>
            </Link>
          )}
        </div>
      </CardHeader>

      {isLoading && <Spinner />}
      {error && <Alert variant="error">Nao foi possivel carregar as campanhas.</Alert>}

      {data && data.data.length === 0 && (
        <Card>
          <p className="text-sm text-muted text-center py-6">
            Nenhuma campanha ainda. {canCreate && 'Crie a primeira para comecar.'}
          </p>
        </Card>
      )}

      {data && data.data.length > 0 && (
        <Card className="p-0 overflow-hidden">
          <div className="divide-y divide-border">
            {data.data.map((c) => (
              <Link
                key={c.id}
                to={`/app/campaigns/${c.id}`}
                className="flex items-center justify-between px-6 py-4 hover:bg-surface transition-colors"
              >
                <div>
                  <p className="text-sm font-medium text-text-dark">{c.name}</p>
                  <p className="font-mono text-xs text-muted">
                    {new Date(c.created_at).toLocaleDateString('pt-BR')}
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <span className="font-mono text-sm text-text-dark">{formatCurrency(c.budget_amount)}</span>
                  <Badge variant={STATE_BADGE[c.state]}>{STATE_LABELS[c.state]}</Badge>
                </div>
              </Link>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
