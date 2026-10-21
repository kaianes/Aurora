import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { briefingApi } from '@/lib/api-client';
import { useAuth } from '@/contexts/auth-context';
import { canManageBriefing } from '@/lib/roles';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import type { DeliverableSpec } from '@/types/api';

const MISSING_FIELD_LABEL: Record<string, string> = {
  dos: "Do's (o que fazer)",
  donts: "Don'ts (o que nao fazer)",
  reference_examples: 'Exemplos de referencia',
  deliverable_spec: 'Especificacao do entregavel',
  deadline: 'Prazo',
};

function toLines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function toIsoOrUndefined(datetimeLocalValue: string): string | undefined {
  if (!datetimeLocalValue) return undefined;
  const date = new Date(datetimeLocalValue);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function isoToDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Briefing composer (US-18a) and one-action issue/distribute (US-18b). This route is explicitly
 * scoped to WCAG 2.2 AA (docs/architecture/e5-briefing-content-workflow.md section 6): every
 * validation error on issue is rendered both as a summary alert and as a field-level error string
 * passed to the Input/Textarea `error` prop, which already wires `aria-invalid` and
 * `aria-describedby` to the error text (3.3.1/3.3.3) -- never conveyed by color alone.
 *
 * A briefing is immutable once issued (section 3.2): once `status === 'issued'`, every field
 * renders read-only and the issue action disappears, replaced by links to the distribution
 * outcome (US-18b) and the Q&A thread (US-31).
 */
export function BriefingComposerPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { currentRole } = useAuth();
  const canManage = currentRole ? canManageBriefing(currentRole) : false;

  const { data: briefing, isLoading, error } = useQuery({
    queryKey: ['briefing', id],
    queryFn: () => briefingApi.get(id!),
    enabled: !!id,
  });

  const [dosText, setDosText] = useState('');
  const [dontsText, setDontsText] = useState('');
  const [examplesText, setExamplesText] = useState('');
  const [format, setFormat] = useState('');
  const [quantity, setQuantity] = useState('');
  const [aspectRatio, setAspectRatio] = useState('');
  const [captionLimit, setCaptionLimit] = useState('');
  const [hashtagsText, setHashtagsText] = useState('');
  const [notes, setNotes] = useState('');
  const [deadline, setDeadline] = useState('');

  const [missingFields, setMissingFields] = useState<string[]>([]);
  const [issueErrorMessage, setIssueErrorMessage] = useState<string | null>(null);
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [issueSuccess, setIssueSuccess] = useState<{ recipients_queued: number } | null>(null);

  useEffect(() => {
    if (!briefing) return;
    setDosText((briefing.dos ?? []).join('\n'));
    setDontsText((briefing.donts ?? []).join('\n'));
    setExamplesText((briefing.reference_examples ?? []).join('\n'));
    setFormat(briefing.deliverable_spec?.format ?? '');
    setQuantity(briefing.deliverable_spec?.quantity != null ? String(briefing.deliverable_spec.quantity) : '');
    setAspectRatio(briefing.deliverable_spec?.aspect_ratio ?? '');
    setCaptionLimit(
      briefing.deliverable_spec?.caption_length_limit != null
        ? String(briefing.deliverable_spec.caption_length_limit)
        : '',
    );
    setHashtagsText((briefing.deliverable_spec?.mandatory_hashtags ?? []).join('\n'));
    setNotes(briefing.deliverable_spec?.notes ?? '');
    setDeadline(isoToDatetimeLocal(briefing.deadline));
  }, [briefing]);

  const buildDeliverableSpec = (): DeliverableSpec | undefined => {
    if (!format.trim() && !aspectRatio.trim() && !captionLimit.trim() && !hashtagsText.trim() && !notes.trim() && !quantity.trim()) {
      return undefined;
    }
    const spec: DeliverableSpec = { format: format.trim() };
    if (quantity.trim()) spec.quantity = Number(quantity);
    if (aspectRatio.trim()) spec.aspect_ratio = aspectRatio.trim();
    if (captionLimit.trim()) spec.caption_length_limit = Number(captionLimit);
    const hashtags = toLines(hashtagsText);
    if (hashtags.length > 0) spec.mandatory_hashtags = hashtags;
    if (notes.trim()) spec.notes = notes.trim();
    return spec;
  };

  const saveMutation = useMutation({
    mutationFn: () =>
      briefingApi.save(id!, {
        dos: toLines(dosText),
        donts: toLines(dontsText),
        reference_examples: toLines(examplesText),
        deliverable_spec: buildDeliverableSpec(),
        deadline: toIsoOrUndefined(deadline),
      }),
    onSuccess: () => {
      setSaveErrorMessage(null);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      queryClient.invalidateQueries({ queryKey: ['briefing', id] });
    },
    onError: (err) => {
      setSaveErrorMessage(
        isAxiosError(err) && err.response?.data?.error?.message
          ? err.response.data.error.message
          : 'Nao foi possivel salvar o briefing agora.',
      );
    },
  });

  const issueMutation = useMutation({
    mutationFn: () => briefingApi.issue(id!),
    onSuccess: (data) => {
      setMissingFields([]);
      setIssueErrorMessage(null);
      setIssueSuccess({ recipients_queued: data.recipients_queued });
      queryClient.invalidateQueries({ queryKey: ['briefing', id] });
    },
    onError: (err) => {
      if (isAxiosError(err) && err.response?.data?.error?.code === 'BRIEFING_INCOMPLETE') {
        const fields: string[] = err.response.data.error.details?.missing_fields ?? [];
        setMissingFields(fields);
        setIssueErrorMessage(
          err.response.data.error.message ??
            'O briefing nao pode ser emitido: os seguintes campos estao vazios.',
        );
        return;
      }
      setMissingFields([]);
      setIssueErrorMessage(
        isAxiosError(err) && err.response?.data?.error?.message
          ? err.response.data.error.message
          : 'Nao foi possivel emitir o briefing agora.',
      );
    },
  });

  // Before saving, run the issue action -- issuing is distributing, in one action (US-18b).
  const handleIssue = async () => {
    await saveMutation.mutateAsync().catch(() => undefined);
    issueMutation.mutate();
  };

  if (isLoading) return <Spinner />;
  if (error) return <Alert variant="error">Nao foi possivel carregar o briefing desta campanha.</Alert>;

  const isIssued = briefing?.status === 'issued';
  const readOnly = isIssued || !canManage;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle>Briefing da campanha</CardTitle>
            <CardDescription>
              Do's, don'ts, exemplos de referencia, especificacao do entregavel e prazo -- tudo em um unico
              briefing estruturado enviado ao pool em uma unica acao.
            </CardDescription>
          </div>
          {briefing && (
            <Badge variant={isIssued ? 'success' : 'warning'}>{isIssued ? 'Emitido' : 'Rascunho'}</Badge>
          )}
        </div>
      </CardHeader>

      {isIssued && briefing?.issued_at && (
        <Alert variant="success">
          <p>
            Este briefing foi emitido em {new Date(briefing.issued_at).toLocaleString('pt-BR')} e nao pode mais ser
            editado.
          </p>
          <div className="mt-2 flex gap-3">
            <Link to={`/app/campaigns/${id}/briefing/distribution`} className="underline font-medium">
              Ver status de distribuicao
            </Link>
            <Link to={`/app/campaigns/${id}/briefing/qa`} className="underline font-medium">
              Ver perguntas dos criadores
            </Link>
          </div>
        </Alert>
      )}

      {issueSuccess && (
        <Alert variant="success">
          Briefing emitido com sucesso. {issueSuccess.recipients_queued} criadores foram colocados na fila de
          distribuicao.{' '}
          <Link to={`/app/campaigns/${id}/briefing/distribution`} className="underline font-medium">
            Ver status de distribuicao
          </Link>
        </Alert>
      )}

      {issueErrorMessage && (
        <Alert variant="error">
          <p id="issue-error-summary">{issueErrorMessage}</p>
          {missingFields.length > 0 && (
            <ul className="mt-2 list-disc pl-5">
              {missingFields.map((field) => (
                <li key={field}>{MISSING_FIELD_LABEL[field] ?? field}</li>
              ))}
            </ul>
          )}
        </Alert>
      )}

      {saveErrorMessage && <Alert variant="error">{saveErrorMessage}</Alert>}
      {saveSuccess && <Alert variant="success">Progresso salvo.</Alert>}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          saveMutation.mutate();
        }}
        noValidate
        className="space-y-6"
      >
        <Card>
          <fieldset disabled={readOnly}>
            <legend className="text-sm font-semibold text-text-dark mb-3">Do's -- o que o criador deve fazer</legend>
            <Textarea
              label="Do's (um por linha)"
              value={dosText}
              onChange={(e) => setDosText(e.target.value)}
              placeholder={'Mostrar o produto sendo aplicado\nUsar iluminacao natural'}
              rows={4}
              error={missingFields.includes('dos') ? 'Obrigatorio para emitir o briefing: adicione ao menos um item.' : undefined}
            />
          </fieldset>
        </Card>

        <Card>
          <fieldset disabled={readOnly}>
            <legend className="text-sm font-semibold text-text-dark mb-3">Don'ts -- o que o criador deve evitar</legend>
            <Textarea
              label="Don'ts (um por linha)"
              value={dontsText}
              onChange={(e) => setDontsText(e.target.value)}
              placeholder={'Nao mencionar concorrentes\nNao usar filtros pesados'}
              rows={4}
              error={missingFields.includes('donts') ? 'Obrigatorio para emitir o briefing: adicione ao menos um item.' : undefined}
            />
          </fieldset>
        </Card>

        <Card>
          <fieldset disabled={readOnly}>
            <legend className="text-sm font-semibold text-text-dark mb-3">Exemplos de referencia</legend>
            <Textarea
              label="Exemplos (um link ou descricao por linha)"
              value={examplesText}
              onChange={(e) => setExamplesText(e.target.value)}
              placeholder={'https://instagram.com/p/exemplo123'}
              rows={3}
              error={
                missingFields.includes('reference_examples')
                  ? 'Obrigatorio para emitir o briefing: adicione ao menos um exemplo (link, descricao ou qualquer texto nao vazio).'
                  : undefined
              }
            />
          </fieldset>
        </Card>

        <Card>
          <fieldset disabled={readOnly}>
            <legend className="text-sm font-semibold text-text-dark mb-3">Especificacao do entregavel</legend>
            {missingFields.includes('deliverable_spec') && (
              <p className="text-sm text-error mb-3" role="alert">
                Obrigatorio para emitir o briefing: informe ao menos o formato do entregavel.
              </p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Formato (obrigatorio, ex: instagram_reel)"
                value={format}
                onChange={(e) => setFormat(e.target.value)}
                error={missingFields.includes('deliverable_spec') && !format.trim() ? 'Informe o formato.' : undefined}
              />
              <Input
                label="Quantidade (opcional)"
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
              <Input
                label="Proporcao (opcional, ex: 9:16)"
                value={aspectRatio}
                onChange={(e) => setAspectRatio(e.target.value)}
              />
              <Input
                label="Limite de caracteres da legenda (opcional)"
                type="number"
                min={1}
                value={captionLimit}
                onChange={(e) => setCaptionLimit(e.target.value)}
              />
            </div>
            <Textarea
              label="Hashtags obrigatorias (uma por linha, opcional)"
              value={hashtagsText}
              onChange={(e) => setHashtagsText(e.target.value)}
              rows={2}
              className="mt-4"
            />
            <Textarea
              label="Observacoes adicionais (opcional)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="mt-4"
            />
          </fieldset>
        </Card>

        <Card>
          <fieldset disabled={readOnly}>
            <legend className="text-sm font-semibold text-text-dark mb-3">Prazo</legend>
            <Input
              label="Prazo (data e hora)"
              type="datetime-local"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              error={missingFields.includes('deadline') ? 'Obrigatorio para emitir o briefing.' : undefined}
            />
          </fieldset>
        </Card>

        {canManage && !isIssued && (
          <div className="flex gap-3">
            <Button type="submit" variant="outline" loading={saveMutation.isPending}>
              Salvar rascunho
            </Button>
            <Button type="button" onClick={handleIssue} loading={issueMutation.isPending || saveMutation.isPending}>
              Emitir briefing para o pool
            </Button>
          </div>
        )}
      </form>
    </div>
  );
}
