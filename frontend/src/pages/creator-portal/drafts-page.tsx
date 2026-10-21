import { useEffect, useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { creatorPortalApi, getCreatorToken } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import type { ContentSubmissionVersion, ReviewDecisionStatus } from '@/types/api';

const STATUS_LABEL: Record<ReviewDecisionStatus, string> = {
  pending: 'Pendente',
  approved: 'Aprovado',
  rejected: 'Rejeitado',
  revision_requested: 'Revisao solicitada',
};

const STATUS_BADGE: Record<ReviewDecisionStatus, 'default' | 'success' | 'warning' | 'error'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'error',
  revision_requested: 'default',
};

function VersionCard({ version }: { version: ContentSubmissionVersion }) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-text-dark">Versao {version.version_number}</p>
          <p className="font-mono text-xs text-muted mt-0.5">
            Enviado em {new Date(version.submitted_at).toLocaleString('pt-BR')}
          </p>
        </div>
        <Badge variant={STATUS_BADGE[version.review_status]}>{STATUS_LABEL[version.review_status]}</Badge>
      </div>

      {version.review_reason && (
        <p className="text-sm text-text-dark mt-3">
          Motivo registrado para a versao {version.version_number}: {version.review_reason}
        </p>
      )}

      {version.review_deadline_at && version.review_status === 'pending' && (
        <p className="font-mono text-xs text-muted mt-2">
          Prazo de revisao: {new Date(version.review_deadline_at).toLocaleString('pt-BR')}
        </p>
      )}

      {version.review_escalated && (
        <Alert variant="warning" className="mt-3">
          O prazo de revisao desta versao foi ultrapassado sem uma decisao e a revisao foi escalada. Isso nao
          significa que sua versao foi recusada -- apenas que a decisao esta demorando mais do que o esperado.
        </Alert>
      )}

      <div className="mt-3">
        <Badge variant={version.safety_gate.cleared ? 'success' : 'warning'}>
          {version.safety_gate.cleared
            ? 'Seguranca de marca: liberado'
            : `Seguranca de marca: ${version.safety_gate.blocking_reason ?? 'nao liberado'}`}
        </Badge>
      </div>

      {version.published_url && (
        <p className="text-sm text-text-dark mt-3">
          Publicado:{' '}
          <a href={version.published_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
            {version.published_url}
          </a>
        </p>
      )}
    </Card>
  );
}

/**
 * Version history per opportunity (US-32a scenario 2, US-33 scenario 2, US-32b): every version
 * ever submitted stays on the page, each with its own status, reason, deadline, and escalation
 * flag, ordered by version_number -- so an earlier rejection's reason can never be confused with
 * a later, still-pending version's own status.
 */
export function DraftsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const opportunityId = searchParams.get('opportunity_id');

  useEffect(() => {
    if (!getCreatorToken()) navigate('/creator-portal/access');
  }, [navigate]);

  const { data: opportunitiesData } = useQuery({
    queryKey: ['creator-opportunities'],
    queryFn: () => creatorPortalApi.listOpportunities(),
  });

  const { data: submissionsData, isLoading, error } = useQuery({
    queryKey: ['creator-submissions', opportunityId],
    queryFn: () => creatorPortalApi.listSubmissions(opportunityId!),
    enabled: !!opportunityId,
  });

  const acceptedOpportunities = useMemo(
    () => (opportunitiesData?.data ?? []).filter((o) => o.status === 'accepted'),
    [opportunitiesData],
  );

  if (!opportunityId) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <CardHeader>
          <CardTitle>Seus rascunhos</CardTitle>
          <CardDescription>Selecione uma oportunidade para ver o historico de versoes enviadas.</CardDescription>
        </CardHeader>
        {acceptedOpportunities.length === 0 ? (
          <Card>
            <p className="text-sm text-muted py-6 text-center">Nenhuma oportunidade aceita ainda.</p>
          </Card>
        ) : (
          <div className="space-y-2">
            {acceptedOpportunities.map((o) => (
              <Link
                key={o.id}
                to={`/creator-portal/drafts?opportunity_id=${o.id}`}
                className="block rounded-xl border border-border bg-white p-4 hover:bg-surface transition-colors"
              >
                <p className="text-sm font-medium text-text-dark">{o.brand_name}</p>
                <p className="text-xs text-muted">{o.deliverable.format}</p>
              </Link>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (isLoading) return <Spinner />;
  if (error) return <Alert variant="error">Nao foi possivel carregar o historico de versoes.</Alert>;

  const versions = [...(submissionsData?.data ?? [])].sort((a, b) => a.version_number - b.version_number);
  const latest = versions[versions.length - 1] ?? null;
  const opportunity = acceptedOpportunities.find((o) => o.id === opportunityId) ?? null;
  const canResubmit = latest && (latest.review_status === 'rejected' || latest.review_status === 'revision_requested');
  const canConfirmPublication = latest && latest.review_status === 'approved' && !latest.published_url;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <CardHeader>
        <CardTitle>Historico de versoes</CardTitle>
        <CardDescription>
          {opportunity ? opportunity.brand_name : 'Toda versao enviada fica registrada, nunca sobrescrita.'}
        </CardDescription>
      </CardHeader>

      {versions.length === 0 ? (
        <Card>
          <p className="text-sm text-muted py-6 text-center">Nenhum rascunho enviado ainda para esta oportunidade.</p>
        </Card>
      ) : (
        <div className="space-y-4">
          {versions
            .slice()
            .reverse()
            .map((v) => (
              <VersionCard key={v.id} version={v} />
            ))}
        </div>
      )}

      <div className="flex gap-4">
        {canResubmit && opportunity && (
          <Link to={`/creator-portal/drafts/new?opportunity_id=${opportunity.id}&campaign_id=${opportunity.campaign_id}`}>
            <Button>Enviar nova versao</Button>
          </Link>
        )}
        {!opportunity && canResubmit && (
          <Link to={`/creator-portal/drafts/new?opportunity_id=${opportunityId}`}>
            <Button>Enviar nova versao</Button>
          </Link>
        )}
        {canConfirmPublication && latest && (
          <Link to={`/creator-portal/drafts/${latest.id}/confirm-publication?opportunity_id=${opportunityId}`}>
            <Button variant="outline">Confirmar publicacao</Button>
          </Link>
        )}
      </div>
    </div>
  );
}
