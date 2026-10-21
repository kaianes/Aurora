import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { creatorPortalApi, getCreatorToken } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

const ERROR_CODE_MESSAGE: Record<string, string> = {
  SUBMISSION_NOT_FOUND: 'Nao foi possivel encontrar este rascunho.',
  DRAFT_NOT_APPROVED: 'Esta versao ainda nao foi aprovada pela marca. A publicacao so pode ser confirmada apos a aprovacao.',
  PUBLICATION_LINK_UNREACHABLE: 'O link informado nao pode ser acessado. Verifique se o post esta publico e o endereco esta correto.',
  PUBLICATION_CONTENT_MISMATCH: 'O conteudo publicado nesse link nao corresponde ao conteudo aprovado.',
};

/**
 * Publication confirmation (US-34). Both gates named by the integration note (section 4.6) are
 * surfaced as distinct, specific error states, never collapsed into one generic failure message:
 * `DRAFT_NOT_APPROVED` (Marina's creative decision), `SAFETY_NOT_CLEARED` (E4's brand-safety
 * gate, with its own `blocking_reason` echoed), `PUBLICATION_LINK_UNREACHABLE`, and
 * `PUBLICATION_CONTENT_MISMATCH`.
 */
export function ConfirmPublicationPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const opportunityId = searchParams.get('opportunity_id');
  const [publishedUrl, setPublishedUrl] = useState('');

  useEffect(() => {
    if (!getCreatorToken()) navigate('/creator-portal/access');
  }, [navigate]);

  const confirmMutation = useMutation({
    mutationFn: () => creatorPortalApi.confirmPublication(id!, { published_url: publishedUrl.trim() }),
  });

  const errorCode =
    confirmMutation.error && isAxiosError(confirmMutation.error) ? confirmMutation.error.response?.data?.error?.code : undefined;
  const blockingReason =
    errorCode === 'SAFETY_NOT_CLEARED' && isAxiosError(confirmMutation.error)
      ? (confirmMutation.error.response?.data?.error?.details as { blocking_reason?: string } | undefined)?.blocking_reason
      : undefined;

  const errorMessage = confirmMutation.error
    ? errorCode === 'SAFETY_NOT_CLEARED'
      ? `O conteudo ainda nao foi liberado pela verificacao de seguranca de marca${blockingReason ? ` (${blockingReason})` : ''}. A publicacao nao pode ser confirmada enquanto isso.`
      : (errorCode && ERROR_CODE_MESSAGE[errorCode]) ||
        (isAxiosError(confirmMutation.error) && confirmMutation.error.response?.data?.error?.message) ||
        'Nao foi possivel confirmar a publicacao agora.'
    : null;

  if (confirmMutation.isSuccess) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <CardHeader>
          <CardTitle>Publicacao confirmada</CardTitle>
        </CardHeader>
        <Alert variant="success">
          <p>Sua publicacao foi registrada em {new Date(confirmMutation.data.published_at).toLocaleString('pt-BR')}.</p>
          <p className="font-mono text-xs mt-1 break-all">{confirmMutation.data.published_url}</p>
        </Alert>
        {opportunityId && (
          <Link to={`/creator-portal/drafts?opportunity_id=${opportunityId}`} className="text-sm text-primary hover:underline">
            Voltar para o historico de versoes
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <CardHeader>
        <CardTitle>Confirmar publicacao</CardTitle>
        <CardDescription>
          Envie o link do post publicado para registrar sua entrega. O conteudo precisa ter sido aprovado pela
          marca e liberado pela verificacao de seguranca.
        </CardDescription>
      </CardHeader>

      {errorMessage && <Alert variant="error">{errorMessage}</Alert>}

      <Card>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            confirmMutation.mutate();
          }}
          className="space-y-4"
          noValidate
        >
          <Input
            label="Link do post publicado"
            type="url"
            value={publishedUrl}
            onChange={(e) => setPublishedUrl(e.target.value)}
            placeholder="https://instagram.com/p/abc123"
          />
          <Button type="submit" loading={confirmMutation.isPending} disabled={!publishedUrl.trim()}>
            Confirmar publicacao
          </Button>
        </form>
      </Card>

      {opportunityId && (
        <Link to={`/creator-portal/drafts?opportunity_id=${opportunityId}`} className="text-sm text-primary hover:underline">
          Voltar para o historico de versoes
        </Link>
      )}
    </div>
  );
}
