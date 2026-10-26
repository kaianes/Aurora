import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { creatorPortalApi, getCreatorToken } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';

/**
 * Duda's automatic media kit (US-25): built from her real audience metrics and, once she
 * has delivered a campaign, her real campaign history too -- never a fabricated result she
 * has not earned. Request-then-poll, the same pattern campaign-report-page.tsx already
 * established for E7's exports. Per
 * docs/architecture/e8-creator-recruitment-growth.md section 6.
 */
export function MediaKitPage() {
  const navigate = useNavigate();
  const [exportId, setExportId] = useState<string | null>(null);

  useEffect(() => {
    if (!getCreatorToken()) {
      navigate('/creator-portal/login');
    }
  }, [navigate]);

  const requestMutation = useMutation({
    mutationFn: () => creatorPortalApi.requestMediaKit(),
    onSuccess: (data) => setExportId(data.export_id),
  });

  const { data: mediaKit, error: mediaKitError } = useQuery({
    queryKey: ['creator-media-kit', exportId],
    queryFn: () => creatorPortalApi.getMediaKit(exportId!),
    enabled: !!exportId,
    refetchInterval: (query) => (query.state.data?.status === 'pending' ? 2000 : false),
  });

  const requestErrorMessage =
    isAxiosError(requestMutation.error) && requestMutation.error.response?.data?.error?.message
      ? requestMutation.error.response.data.error.message
      : requestMutation.isError
        ? 'Nao foi possivel solicitar seu media kit agora.'
        : null;

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <CardHeader>
        <CardTitle>Seu media kit</CardTitle>
        <CardDescription>
          Um documento pronto com sua audiencia e seu historico de campanhas, para voce
          compartilhar com marcas.
        </CardDescription>
      </CardHeader>

      {requestErrorMessage && <Alert variant="error">{requestErrorMessage}</Alert>}
      {mediaKitError && (
        <Alert variant="error">
          {isAxiosError(mediaKitError) && mediaKitError.response?.data?.error?.message
            ? mediaKitError.response.data.error.message
            : 'Nao foi possivel carregar o media kit solicitado.'}
        </Alert>
      )}

      {!mediaKit && (
        <Card>
          <p className="text-sm text-text-dark mb-4">
            Gere seu media kit automaticamente, sem precisar reunir prints ou numeros a mao.
          </p>
          <Button onClick={() => requestMutation.mutate()} loading={requestMutation.isPending}>
            Gerar media kit
          </Button>
        </Card>
      )}

      {mediaKit?.status === 'pending' && (
        <Card>
          <div className="flex items-center gap-3 text-sm text-muted">
            <Spinner className="h-5 w-5" />
            Gerando seu media kit. Isso pode levar alguns segundos.
          </div>
        </Card>
      )}

      {mediaKit?.status === 'failed' && (
        <Card>
          <Alert variant="error">
            {mediaKit.message ?? 'Nao foi possivel gerar seu media kit. Tente novamente.'}
          </Alert>
          <Button className="mt-4" onClick={() => requestMutation.mutate()} loading={requestMutation.isPending}>
            Tentar novamente
          </Button>
        </Card>
      )}

      {mediaKit?.status === 'ready' && (
        <Card>
          <h3 className="text-sm font-semibold text-text-dark mb-3">Media kit #{mediaKit.id}</h3>

          {mediaKit.has_campaign_history === false && (
            <Alert variant="info" className="mb-3">
              {mediaKit.campaign_section_message ??
                'Esta secao sera preenchida apos sua primeira entrega de campanha.'}
            </Alert>
          )}

          <p className="text-sm text-text-dark mb-4">
            Seu media kit inclui sua audiencia, engajamento e nicho reais
            {mediaKit.has_campaign_history ? ', alem do seu historico de campanhas entregues.' : '.'}
          </p>

          {mediaKit.pdf_document_url && (
            <a href={mediaKit.pdf_document_url} target="_blank" rel="noopener noreferrer">
              <Button variant="outline">Baixar PDF</Button>
            </a>
          )}

          <div className="mt-4">
            <Button variant="ghost" size="sm" onClick={() => setExportId(null)}>
              Gerar novo media kit
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
