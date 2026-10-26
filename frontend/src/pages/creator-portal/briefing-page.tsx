import { useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { creatorPortalApi, getCreatorToken } from '@/lib/api-client';
import { Alert } from '@/components/ui/alert';
import { Card, CardHeader, CardDescription } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';

/**
 * Briefing viewer (US-30). WCAG 2.2 AA scoped (docs/architecture/e5-briefing-content-workflow.md
 * section 6): headings follow a single h1/h2 hierarchy, every list is a semantic <ul>/<ol>, and
 * the deliverable specification renders as a description list (<dl>) rather than a free-text
 * paragraph, so a detail more specific than the campaign's general message (US-30 scenario 2,
 * e.g. a required aspect ratio or mandatory hashtag) is its own named term, not buried in prose.
 *
 * `BRIEFING_NOT_AVAILABLE` (US-30 scenario 3) covers "no briefing", "not issued", and "opportunity
 * not currently accepted" with the same one message -- this page never tries to tell those apart,
 * matching the backend's own information-leakage discipline (section 4.3).
 */
export function CreatorBriefingPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const campaignId = searchParams.get('campaign_id') ?? '';

  useEffect(() => {
    if (!getCreatorToken()) navigate('/creator-portal/login');
  }, [navigate]);

  const { data: briefing, isLoading, error } = useQuery({
    queryKey: ['creator-briefing', campaignId],
    queryFn: () => creatorPortalApi.getBriefing(campaignId),
    enabled: !!campaignId,
  });

  if (!campaignId) {
    return <Alert variant="error">Nenhuma campanha informada.</Alert>;
  }

  if (isLoading) return <Spinner />;
  if (error) return <Alert variant="error">Nao foi possivel carregar o briefing agora.</Alert>;

  if (!briefing) {
    return (
      <div className="mx-auto max-w-2xl">
        <Alert variant="warning">
          Nenhum briefing disponivel para voce nesta campanha. Isso pode significar que o briefing ainda nao foi
          emitido ou que sua oportunidade nesta campanha nao esta mais ativa.
        </Alert>
      </div>
    );
  }

  const spec = briefing.deliverable_spec;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <CardHeader>
        <h1 className="text-lg font-semibold text-text-dark">Briefing da campanha</h1>
        <CardDescription>
          Tudo que voce precisa para criar o conteudo certo, sem adivinhar o que a marca quer.
        </CardDescription>
      </CardHeader>

      <Card>
        <h2 className="text-sm font-semibold text-text-dark mb-3">O que fazer</h2>
        <ul className="list-disc pl-5 space-y-1 text-sm text-text-dark">
          {(briefing.dos ?? []).map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      </Card>

      <Card>
        <h2 className="text-sm font-semibold text-text-dark mb-3">O que evitar</h2>
        <ul className="list-disc pl-5 space-y-1 text-sm text-text-dark">
          {(briefing.donts ?? []).map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      </Card>

      <Card>
        <h2 className="text-sm font-semibold text-text-dark mb-3">Exemplos de referencia</h2>
        <ul className="list-disc pl-5 space-y-1 text-sm text-text-dark break-words">
          {(briefing.reference_examples ?? []).map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      </Card>

      {spec && (
        <Card>
          <h2 className="text-sm font-semibold text-text-dark mb-3">Especificacao do entregavel</h2>
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="font-semibold text-text-dark inline">Formato: </dt>
              <dd className="inline font-mono">{spec.format}</dd>
            </div>
            {spec.quantity != null && (
              <div>
                <dt className="font-semibold text-text-dark inline">Quantidade: </dt>
                <dd className="inline font-mono">{spec.quantity}</dd>
              </div>
            )}
            {spec.aspect_ratio && (
              <div>
                <dt className="font-semibold text-text-dark inline">Proporcao: </dt>
                <dd className="inline font-mono">{spec.aspect_ratio}</dd>
              </div>
            )}
            {spec.caption_length_limit != null && (
              <div>
                <dt className="font-semibold text-text-dark inline">Limite de caracteres da legenda: </dt>
                <dd className="inline font-mono">{spec.caption_length_limit}</dd>
              </div>
            )}
            {spec.mandatory_hashtags && spec.mandatory_hashtags.length > 0 && (
              <div>
                <dt className="font-semibold text-text-dark">Hashtags obrigatorias:</dt>
                <dd>
                  <ul className="list-disc pl-5 font-mono">
                    {spec.mandatory_hashtags.map((tag, i) => (
                      <li key={i}>{tag}</li>
                    ))}
                  </ul>
                </dd>
              </div>
            )}
            {spec.notes && (
              <div>
                <dt className="font-semibold text-text-dark inline">Observacoes: </dt>
                <dd className="inline">{spec.notes}</dd>
              </div>
            )}
          </dl>
        </Card>
      )}

      {briefing.deadline && (
        <Card>
          <h2 className="text-sm font-semibold text-text-dark mb-2">Prazo</h2>
          <p className="font-mono text-sm text-text-dark">{new Date(briefing.deadline).toLocaleString('pt-BR')}</p>
        </Card>
      )}

      <div className="flex gap-4">
        <Link to={`/creator-portal/briefing/qa?campaign_id=${campaignId}`} className="text-sm text-primary hover:underline">
          Fazer uma pergunta sobre o briefing
        </Link>
      </div>
    </div>
  );
}
