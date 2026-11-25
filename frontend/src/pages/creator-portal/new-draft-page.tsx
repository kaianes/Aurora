import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { creatorPortalApi, getCreatorToken } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Alert } from '@/components/ui/alert';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

const CHANNEL_LABEL: Record<string, string> = {
  caption: 'Legenda',
  on_screen_text: 'Texto na tela',
  audio: 'Audio',
  system: 'Sistema',
};

const ERROR_CODE_MESSAGE: Record<string, string> = {
  OPPORTUNITY_NOT_FOUND: 'Nenhuma oportunidade aceita foi encontrada para este envio.',
  CAMPAIGN_NOT_ACTIVE: 'Esta campanha não esta ativa no momento, portanto não aceita novos envios.',
  PENDING_REVIEW_IN_PROGRESS: 'A versao mais recente deste envio ainda esta aguardando revisão. Aguarde a decisão antes de enviar outra.',
  ALREADY_APPROVED: 'Esta entrega ja foi aprovada e não aceita novas versoes.',
};

const ANALYSIS_STEPS = [
  'Extraindo texto visivel do video...',
  'Transcrevendo audio do conteudo...',
  'Verificando regras de seguranca de marca...',
];

export function NewDraftPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    if (!getCreatorToken()) navigate('/creator-portal/login');
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
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [submissionId, setSubmissionId] = useState<string | null>(null);
  const [versionNumber, setVersionNumber] = useState<number | null>(null);
  const [reviewDeadlineAt, setReviewDeadlineAt] = useState<string | null>(null);
  const [analysisStep, setAnalysisStep] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedOpportunity = acceptedOpportunities.find((o) => o.id === opportunityId) ?? null;
  const campaignId = selectedOpportunity?.campaign_id ?? searchParams.get('campaign_id') ?? '';

  function handleVideoSelect(file: File) {
    if (!file.type.startsWith('video/')) return;
    setVideoFile(file);
    if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
    setVideoPreviewUrl(URL.createObjectURL(file));
  }

  function removeVideo() {
    setVideoFile(null);
    if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
    setVideoPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  // Demo mock: skip real backend call entirely
  const submitMutation = useMutation({
    mutationFn: async () => {
      setAnalysisStep(0);
      return {
        content_submission_id: 'demo-' + Date.now(),
        version_number: 1,
        review_deadline_at: null,
        safety_check_id: 'demo-check',
        status: 'pending',
        poll_url: '',
      };
    },
    onSuccess: (data) => {
      setSubmissionId(data.content_submission_id);
      setVersionNumber(data.version_number ?? null);
      setReviewDeadlineAt(data.review_deadline_at ?? null);
    },
  });

  // Demo mock: show a flagged result after a brief animation delay,
  // regardless of the real backend check status.
  const [demoCheck, setDemoCheck] = useState<any>(null);
  useEffect(() => {
    if (!submissionId) { setDemoCheck(null); return; }
    const t = setTimeout(() => {
      setDemoCheck({
        status: 'flagged',
        tier_reached: 'tier1',
        triggered_rules: [
          { rule_type: 'prohibited_topic', channel: 'caption', matched_excerpt: 'parabenos' },
          { rule_type: 'prohibited_topic', channel: 'caption', matched_excerpt: 'testes em animais' },
        ],
      });
    }, 6500);
    return () => clearTimeout(t);
  }, [submissionId]);
  const check = demoCheck;

  useEffect(() => {
    if (!submissionId || (check && check.status !== 'pending')) return;
    const interval = setInterval(() => {
      setAnalysisStep((prev) => (prev < ANALYSIS_STEPS.length - 1 ? prev + 1 : prev));
    }, 2200);
    return () => clearInterval(interval);
  }, [submissionId, check]);

  const submitErrorCode =
    submitMutation.error && isAxiosError(submitMutation.error) ? submitMutation.error.response?.data?.error?.code : undefined;
  const submitError = submitMutation.error
    ? (submitErrorCode && ERROR_CODE_MESSAGE[submitErrorCode]) ||
      (isAxiosError(submitMutation.error) && submitMutation.error.response?.data?.error?.message) ||
      'Não foi possível enviar seu rascunho agora.'
    : null;

  const resetForm = () => {
    setSubmissionId(null);
    setVersionNumber(null);
    setReviewDeadlineAt(null);
    setCaptionText('');
    removeVideo();
    setAnalysisStep(0);
    submitMutation.reset();
  };

  if (submissionId) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <CardHeader>
          <CardTitle>Rascunho enviado</CardTitle>
          <CardDescription>Seu rascunho foi registrado e esta sendo verificado antes de avancar para revisão.</CardDescription>
        </CardHeader>

        <Card>
          <div className="space-y-1 text-sm text-text-primary">
            {versionNumber != null && <p className="font-mono">Versao: {versionNumber}</p>}
            {reviewDeadlineAt && (
              <p className="font-mono">Prazo de revisão: {new Date(reviewDeadlineAt).toLocaleString('pt-BR')}</p>
            )}
          </div>
        </Card>

        <Card>
          {!check || check.status === 'pending' ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 text-sm text-text-secondary">
                <svg className="h-5 w-5 animate-spin text-violet-400 shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span>Analisando conteudo com IA...</span>
              </div>
              <div className="space-y-2 pl-8">
                {ANALYSIS_STEPS.map((step, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    {i < analysisStep ? (
                      <svg className="h-4 w-4 text-emerald-400 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    ) : i === analysisStep ? (
                      <svg className="h-4 w-4 animate-spin text-violet-400 shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    ) : (
                      <div className="h-4 w-4 rounded-full border border-border-default shrink-0" />
                    )}
                    <span className={i <= analysisStep ? 'text-text-primary' : 'text-text-muted'}>{step}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : check.status === 'passed' ? (
            <Alert variant="success">
              Sua submissao passou na verificação de segurança de marca e pode avancar no fluxo de aprovacao.
              {check.tier_reached && (
                <span className="block font-mono text-xs mt-1">Verificacao concluida em: {check.tier_reached}</span>
              )}
            </Alert>
          ) : check.status === 'flagged' ? (
            <div className="space-y-3">
              <Alert variant="error">
                Sua submissao não passou na verificação de segurança de marca e não pode ser publicada enquanto nao
                for revisada.
              </Alert>
              <div>
                <p className="text-xs font-semibold text-text-secondary uppercase mb-1">Regras acionadas</p>
                <ul className="space-y-1">
                  {(check.triggered_rules ?? []).map((rule: any, i: number) => (
                    <li key={i} className="font-mono text-xs text-text-primary bg-bg-surface rounded px-2 py-1">
                      {CHANNEL_LABEL[rule.channel] ?? rule.channel}
                      {rule.rule_type && ` · ${rule.rule_type}`}
                      {rule.matched_excerpt && <span className="text-text-secondary"> · "{rule.matched_excerpt}"</span>}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <Alert variant="warning">
              {check.message ??
                'A verificação de segurança de marca não pode ser concluida a tempo. O conteúdo permanece bloqueado para publicação e foi enviado para revisão humana.'}
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
              className="text-sm text-violet-400 hover:underline self-center"
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
        <CardTitle>Enviar rascunho de conteúdo</CardTitle>
        <CardDescription>
          Envie seu Reels ou video com a legenda. A IA vai analisar o conteudo para segurança de marca antes da revisão.
        </CardDescription>
      </CardHeader>

      {submitError && <Alert variant="error">{submitError}</Alert>}

      <Card>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitMutation.mutate();
          }}
          className="space-y-5"
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
            <p className="text-sm text-text-secondary mt-1">Apenas oportunidades que voce ja aceitou podem receber rascunhos.</p>
          </div>

          {/* Video upload area */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">
              Video ou Reels
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleVideoSelect(file);
              }}
            />

            {videoFile && videoPreviewUrl ? (
              <div className="relative rounded-xl border border-border-default bg-bg-surface overflow-hidden">
                <video
                  src={videoPreviewUrl}
                  className="w-full max-h-80 object-contain bg-black"
                  controls
                  muted
                />
                <div className="flex items-center justify-between p-3 border-t border-border-default">
                  <div className="flex items-center gap-2 min-w-0">
                    <svg className="h-4 w-4 text-violet-400 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6zm12.553-1.106A1 1 0 0114 5.882v8.236a1 1 0 001.447.894l4-2a1 1 0 000-1.788l-4-2.118z" />
                    </svg>
                    <span className="text-sm text-text-primary truncate">{videoFile.name}</span>
                    <span className="text-xs text-text-muted shrink-0">
                      {(videoFile.size / (1024 * 1024)).toFixed(1)} MB
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={removeVideo}
                    className="text-text-muted hover:text-error transition-colors p-1"
                    aria-label="Remover video"
                  >
                    <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  </button>
                </div>
              </div>
            ) : (
              <div
                role="button"
                tabIndex={0}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file) handleVideoSelect(file);
                }}
                className={`flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 cursor-pointer transition-all duration-200 ${
                  dragOver
                    ? 'border-violet-500 bg-violet-500/5'
                    : 'border-border-default hover:border-violet-500/50 hover:bg-bg-hover'
                }`}
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-violet-500/10">
                  <svg className="h-6 w-6 text-violet-400" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6zm12.553-1.106A1 1 0 0114 5.882v8.236a1 1 0 001.447.894l4-2a1 1 0 000-1.788l-4-2.118z" />
                  </svg>
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-text-primary">
                    Arraste seu video aqui ou clique para selecionar
                  </p>
                  <p className="text-xs text-text-muted mt-1">MP4, MOV, WebM — até 100 MB</p>
                </div>
              </div>
            )}
          </div>

          <Textarea
            label="Legenda (obrigatorio)"
            value={captionText}
            onChange={(e) => setCaptionText(e.target.value)}
          />

          <Button type="submit" loading={submitMutation.isPending} disabled={!campaignId || !opportunityId || !captionText.trim()}>
            Enviar rascunho
          </Button>
        </form>
      </Card>

      {opportunityId && (
        <Link to={`/creator-portal/drafts?opportunity_id=${opportunityId}`} className="text-sm text-violet-400 hover:underline">
          Ver versoes ja enviadas para esta oportunidade
        </Link>
      )}
    </div>
  );
}
