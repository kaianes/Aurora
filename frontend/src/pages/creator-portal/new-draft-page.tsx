import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { creatorPortalApi, getCreatorToken } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Alert } from '@/components/ui/alert';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';

const CHANNEL_LABEL: Record<string, string> = {
  caption: 'Legenda',
  on_screen_text: 'Texto na tela',
  audio: 'Audio',
  system: 'Sistema',
};

const ERROR_CODE_MESSAGE: Record<string, string> = {
  OPPORTUNITY_NOT_FOUND: 'Nenhuma oportunidade aceita foi encontrada para este envio.',
  CAMPAIGN_NOT_ACTIVE: 'Esta campanha nao esta ativa no momento, portanto nao aceita novos envios.',
  PENDING_REVIEW_IN_PROGRESS: 'A versao mais recente deste envio ainda esta aguardando revisao. Aguarde a decisao antes de enviar outra.',
  ALREADY_APPROVED: 'Esta entrega ja foi aprovada e nao aceita novas versoes.',
};

/**
 * Draft submission (US-32a), replacing E4's gap-filler form at the dedicated route this epic's
 * architecture names (section 6). Every version submitted here is retained, never overwritten
 * (section 3.3) -- the backend enforces the resubmission precondition, this page only surfaces
 * the specific, named reason when it refuses (scenario 3), rather than inventing its own.
 *
 * On success, the stated review deadline is shown immediately (US-32b scenario 1), alongside the
 * same safety-check verdict flow E4 already established for this intake path.
 */
export function NewDraftPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    if (!getCreatorToken()) navigate('/creator-portal/access');
  }, [navigate]);

  const { data: opportunitiesData } = useQuery({
    queryKey: ['creator-opportunities'],
    queryFn: () => creatorPortalApi.listOpportunities(),
  });

  const acceptedOpportunities = useMemo(
    () => (opportunitiesData?.data ?? []).filter((o) => o.status === 'accepted'),
    [opportunitiesData],
  );

  const [opportunityId, setOpportunityId] = useState(searchParams.get('opportunity_id') ?? '');
  const [captionText, setCaptionText] = useState('');
  const [onScreenText, setOnScreenText] = useState('');
  const [audioTranscript, setAudioTranscript] = useState('');
  const [mediaAssetUrl, setMediaAssetUrl] = useState('');
  const [submissionId, setSubmissionId] = useState<string | null>(null);
  const [versionNumber, setVersionNumber] = useState<number | null>(null);
  const [reviewDeadlineAt, setReviewDeadlineAt] = useState<string | null>(null);

  const selectedOpportunity = acceptedOpportunities.find((o) => o.id === opportunityId) ?? null;
  const campaignId = selectedOpportunity?.campaign_id ?? searchParams.get('campaign_id') ?? '';

  const submitMutation = useMutation({
    mutationFn: () =>
      creatorPortalApi.submitContent({
        campaign_id: campaignId,
        opportunity_id: opportunityId || undefined,
        caption_text: captionText,
        on_screen_text: onScreenText || undefined,
        audio_transcript: audioTranscript || undefined,
        media_asset_url: mediaAssetUrl || undefined,
      }),
    onSuccess: (data) => {
      setSubmissionId(data.content_submission_id);
      setVersionNumber(data.version_number ?? null);
      setReviewDeadlineAt(data.review_deadline_at ?? null);
    },
  });

  const { data: check } = useQuery({
    queryKey: ['safety-check', submissionId],
    queryFn: () => creatorPortalApi.getSafetyCheck(submissionId!),
    enabled: !!submissionId,
    refetchInterval: (query) => (query.state.data?.status === 'pending' ? 2000 : false),
  });

  const submitErrorCode =
    submitMutation.error && isAxiosError(submitMutation.error) ? submitMutation.error.response?.data?.error?.code : undefined;
  const submitError = submitMutation.error
    ? (submitErrorCode && ERROR_CODE_MESSAGE[submitErrorCode]) ||
      (isAxiosError(submitMutation.error) && submitMutation.error.response?.data?.error?.message) ||
      'Nao foi possivel enviar seu rascunho agora.'
    : null;

  const resetForm = () => {
    setSubmissionId(null);
    setVersionNumber(null);
    setReviewDeadlineAt(null);
    setCaptionText('');
    setOnScreenText('');
    setAudioTranscript('');
    setMediaAssetUrl('');
    submitMutation.reset();
  };

  if (submissionId) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <CardHeader>
          <CardTitle>Rascunho enviado</CardTitle>
          <CardDescription>Seu rascunho foi registrado e esta sendo verificado antes de avancar para revisao.</CardDescription>
        </CardHeader>

        <Card>
          <div className="space-y-1 text-sm text-text-dark">
            {versionNumber != null && <p className="font-mono">Versao: {versionNumber}</p>}
            {reviewDeadlineAt && (
              <p className="font-mono">Prazo de revisao: {new Date(reviewDeadlineAt).toLocaleString('pt-BR')}</p>
            )}
          </div>
        </Card>

        <Card>
          {!check || check.status === 'pending' ? (
            <div className="flex items-center gap-3 text-sm text-muted">
              <Spinner className="h-5 w-5" />
              Verificando sua submissao. Isso pode levar alguns minutos.
            </div>
          ) : check.status === 'passed' ? (
            <Alert variant="success">
              Sua submissao passou na verificacao de seguranca de marca e pode avancar no fluxo de aprovacao.
              {check.tier_reached && (
                <span className="block font-mono text-xs mt-1">Verificacao concluida em: {check.tier_reached}</span>
              )}
            </Alert>
          ) : check.status === 'flagged' ? (
            <div className="space-y-3">
              <Alert variant="error">
                Sua submissao nao passou na verificacao de seguranca de marca e nao pode ser publicada enquanto nao
                for revisada.
              </Alert>
              <div>
                <p className="text-xs font-semibold text-muted uppercase mb-1">Regras acionadas</p>
                <ul className="space-y-1">
                  {(check.triggered_rules ?? []).map((rule, i) => (
                    <li key={i} className="font-mono text-xs text-text-dark bg-surface rounded px-2 py-1">
                      {CHANNEL_LABEL[rule.channel] ?? rule.channel}
                      {rule.rule_type && ` · ${rule.rule_type}`}
                      {rule.matched_excerpt && <span className="text-muted"> · "{rule.matched_excerpt}"</span>}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <Alert variant="warning">
              {check.message ??
                'A verificacao de seguranca de marca nao pode ser concluida a tempo. O conteudo permanece bloqueado para publicacao e foi enviado para revisao humana.'}
            </Alert>
          )}
        </Card>

        <div className="flex gap-4">
          <Button variant="outline" onClick={resetForm}>
            Enviar outro rascunho
          </Button>
          {opportunityId && (
            <Link
              to={`/creator-portal/drafts?opportunity_id=${opportunityId}`}
              className="text-sm text-primary hover:underline self-center"
            >
              Ver historico de versoes
            </Link>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <CardHeader>
        <CardTitle>Enviar rascunho de conteudo</CardTitle>
        <CardDescription>
          Seu rascunho sera verificado quanto a seguranca de marca e depois revisado pela marca antes da publicacao.
        </CardDescription>
      </CardHeader>

      {submitError && <Alert variant="error">{submitError}</Alert>}

      <Card>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitMutation.mutate();
          }}
          className="space-y-4"
          noValidate
        >
          <div>
            <Select
              label="Oportunidade"
              value={opportunityId}
              onChange={(e) => setOpportunityId(e.target.value)}
              placeholder="Selecione uma oportunidade aceita"
              options={acceptedOpportunities.map((o) => ({
                value: o.id,
                label: `${o.brand_name} · ${o.deliverable.format}`,
              }))}
            />
            <p className="text-sm text-muted mt-1">Apenas oportunidades que voce ja aceitou podem receber rascunhos.</p>
          </div>
          <Textarea label="Legenda (obrigatorio)" value={captionText} onChange={(e) => setCaptionText(e.target.value)} />
          <Textarea label="Texto na tela (opcional)" value={onScreenText} onChange={(e) => setOnScreenText(e.target.value)} />
          <Textarea
            label="Transcricao de audio (opcional)"
            value={audioTranscript}
            onChange={(e) => setAudioTranscript(e.target.value)}
          />
          <Input
            label="Link do arquivo de midia (opcional)"
            value={mediaAssetUrl}
            onChange={(e) => setMediaAssetUrl(e.target.value)}
            hint="Referencia S3 do video ou imagem bruta, usada quando nao ha texto na tela ou audio informados diretamente."
          />
          <Button type="submit" loading={submitMutation.isPending} disabled={!campaignId || !opportunityId || !captionText.trim()}>
            Enviar rascunho
          </Button>
        </form>
      </Card>

      {opportunityId && (
        <Link to={`/creator-portal/drafts?opportunity_id=${opportunityId}`} className="text-sm text-primary hover:underline">
          Ver versoes ja enviadas para esta oportunidade
        </Link>
      )}
    </div>
  );
}
