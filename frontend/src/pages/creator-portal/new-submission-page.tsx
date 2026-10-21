import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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

/**
 * Minimal content submission form (US-16), the gap-period creator-facing intake endpoint this
 * epic exposes ahead of E5's real draft flow (section 3.3). Polls the safety check until it
 * resolves and renders all three outcomes the gate can produce: passed, flagged (with the
 * specific rule and channel cited), or check_unavailable.
 *
 * Note: the architecture contract takes `media_asset_url` as a plain S3 reference string in the
 * JSON body -- no file-upload endpoint is defined anywhere in this epic's contract, so this is a
 * text field rather than a file picker. Flagging this as a known gap, not an invented endpoint.
 */
export function NewSubmissionPage() {
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
    onSuccess: (data) => setSubmissionId(data.content_submission_id),
  });

  const { data: check } = useQuery({
    queryKey: ['safety-check', submissionId],
    queryFn: () => creatorPortalApi.getSafetyCheck(submissionId!),
    enabled: !!submissionId,
    refetchInterval: (query) => (query.state.data?.status === 'pending' ? 2000 : false),
  });

  const submitError =
    submitMutation.error && isAxiosError(submitMutation.error) && submitMutation.error.response?.data?.error?.message
      ? submitMutation.error.response.data.error.message
      : submitMutation.error
        ? 'Nao foi possivel enviar sua submissao agora.'
        : null;

  const resetForm = () => {
    setSubmissionId(null);
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
          <CardTitle>Verificacao de seguranca de marca</CardTitle>
          <CardDescription>Sua submissao esta sendo analisada antes de poder avancar para publicacao.</CardDescription>
        </CardHeader>

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

        <Button variant="outline" onClick={resetForm}>
          Enviar outra submissao
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <CardHeader>
        <CardTitle>Enviar conteudo para verificacao</CardTitle>
        <CardDescription>
          Seu conteudo sera verificado quanto a seguranca de marca antes de poder avancar no fluxo de aprovacao.
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
            <p className="text-sm text-muted mt-1">Apenas oportunidades que voce ja aceitou podem receber submissoes.</p>
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
          <Button type="submit" loading={submitMutation.isPending} disabled={!campaignId || !captionText.trim()}>
            Enviar para verificacao
          </Button>
        </form>
      </Card>
    </div>
  );
}
