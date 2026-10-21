import { useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { creatorPortalApi, getCreatorToken } from '@/lib/api-client';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';

/** Small colored data point used as a motif accent next to a metric, on a thin grid line. */
function MetricDot({ color }: { color: string }) {
  return <span className="inline-block h-2 w-2 rounded-full mr-2" style={{ backgroundColor: color }} />;
}

// Only 'min_engagement_rate' is named as an example in the architecture document (section
// 5.7); any other key the qualification engine returns is shown humanized rather than
// invented a translation for, so nothing here fabricates a criterion name it was not given.
const CRITERIA_LABELS: Record<string, string> = {
  min_engagement_rate: 'Taxa de engajamento minima',
  min_audience_size: 'Tamanho minimo de audiencia',
};

function humanizeCriterion(key: string) {
  return CRITERIA_LABELS[key] ?? key.replace(/_/g, ' ');
}

function formatDateTime(iso?: string | null) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('pt-BR');
}

/**
 * Onboarding step 5 (US-24.4): the qualification outcome, told to her immediately and
 * named explicitly when she falls short, never a generic rejection. Per
 * docs/architecture/e8-creator-recruitment-growth.md section 5.7.
 */
export function OnboardingResultPage() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!getCreatorToken()) {
      navigate('/creator-portal/login');
    }
  }, [navigate]);

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['creator-onboarding-status'],
    queryFn: () => creatorPortalApi.getOnboardingStatus(),
  });

  if (isLoading || !data) return <Spinner />;

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <CardHeader>
        <CardTitle>Resultado da sua qualificacao</CardTitle>
        <CardDescription>Isto define se voce ja pode receber oportunidades de marcas.</CardDescription>
      </CardHeader>

      {data.onboarding_status === 'qualified' && (
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <Badge variant="success">Voce esta qualificada</Badge>
          </div>
          <p className="text-sm text-text-dark mb-4">
            Seu perfil esta ativo e elegivel para campanhas que combinem com sua audiencia.
          </p>
          <div className="space-y-1.5 border-t border-border pt-3">
            <p className="flex items-center font-mono text-sm text-text-dark">
              <MetricDot color="var(--color-signal-green)" />
              Tamanho da audiencia: {data.audience_size?.toLocaleString('pt-BR') ?? '-'}
            </p>
            <p className="flex items-center font-mono text-sm text-text-dark">
              <MetricDot color="var(--color-performance-orange)" />
              Taxa de engajamento: {data.engagement_rate ? `${data.engagement_rate}%` : '-'}
            </p>
            <p className="flex items-center font-mono text-sm text-text-dark">
              <MetricDot color="var(--color-strategy-violet)" />
              Score de autenticidade:{' '}
              {data.authenticity_status === 'scored' ? (data.authenticity_score ?? '-') : 'Pendente'}
            </p>
            {data.linked_platforms && (
              <p className="flex items-center font-mono text-sm text-text-dark">
                <MetricDot color="var(--color-creator-pink)" />
                Redes conectadas: {data.linked_platforms.join(', ')}
              </p>
            )}
          </div>
          <p className="font-mono text-xs text-muted mt-3">
            Decidido em {formatDateTime(data.qualification_decided_at)}
          </p>
          <Link to="/creator-portal/opportunities" className="mt-4 inline-block">
            <Button>Ver oportunidades</Button>
          </Link>
        </Card>
      )}

      {data.onboarding_status === 'not_qualified' && (
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <Badge variant="warning">Ainda nao qualificada</Badge>
          </div>
          <p className="text-sm text-text-dark mb-3">
            Seu perfil ainda nao atende aos criterios abaixo. Continuar crescendo sua audiencia e
            engajamento pode mudar este resultado nas proximas atualizacoes.
          </p>
          {data.qualification_missing_criteria && data.qualification_missing_criteria.length > 0 && (
            <ul className="space-y-1.5 border-t border-border pt-3">
              {data.qualification_missing_criteria.map((key) => (
                <li key={key} className="flex items-center font-mono text-sm text-text-dark">
                  <MetricDot color="var(--color-performance-orange)" />
                  {humanizeCriterion(key)}
                </li>
              ))}
            </ul>
          )}
          <p className="font-mono text-xs text-muted mt-3">
            Decidido em {formatDateTime(data.qualification_decided_at)}
          </p>
          <Link to="/creator-portal/social-accounts" className="mt-4 inline-block">
            <Button variant="outline">Gerenciar minhas redes</Button>
          </Link>
        </Card>
      )}

      {data.onboarding_status === 'pending' && (
        <Card>
          <Alert variant="info">
            {data.message ?? 'Ainda estamos analisando seu perfil. Avisaremos por email quando a decisao estiver pronta.'}
          </Alert>
          {data.qualification_expected_ready_at && (
            <p className="font-mono text-xs text-muted mt-3">
              Previsao: {formatDateTime(data.qualification_expected_ready_at)}
            </p>
          )}
          <Button variant="outline" className="mt-4" onClick={() => refetch()} loading={isRefetching}>
            Verificar novamente
          </Button>
        </Card>
      )}
    </div>
  );
}
