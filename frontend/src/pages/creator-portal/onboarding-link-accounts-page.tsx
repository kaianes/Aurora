import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { creatorPortalApi, getCreatorToken } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import type { SocialPlatform } from '@/types/api';

const PLATFORMS: { value: SocialPlatform; label: string }[] = [
  { value: 'instagram', label: 'Instagram' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'youtube', label: 'YouTube' },
];

const RESULT_MESSAGE: Record<string, string> = {
  denied: 'Voce negou a autorizacao para',
  unavailable: 'A plataforma esta indisponivel no momento para',
};

/**
 * Onboarding step 2 (US-24.1): connect at least one social platform via its own
 * authorization flow. Aurora never asks for a password here -- only the simulated
 * platform consent screen this pilot's SocialAuthAdapter stub points at (ADR-0050).
 * Denial or an unavailable platform never blocks her from continuing with whichever
 * platforms she has already connected (scenario 3).
 * Per docs/architecture/e8-creator-recruitment-growth.md section 5.3-5.6.
 */
export function OnboardingLinkAccountsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    if (!getCreatorToken()) {
      navigate('/creator-portal/login');
    }
  }, [navigate]);

  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['creator-social-accounts'],
    queryFn: () => creatorPortalApi.listSocialAccounts(),
  });

  const authorizeMutation = useMutation({
    mutationFn: (platform: SocialPlatform) => creatorPortalApi.authorizeSocialAccount(platform),
    onSuccess: (data) => {
      // The authorize_url is Aurora's own simulated consent page (ADR-0050) -- a real
      // full-page redirect, exactly as a genuine platform OAuth screen would require.
      window.location.href = data.authorize_url;
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: (platform: SocialPlatform) => creatorPortalApi.disconnectSocialAccount(platform),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['creator-social-accounts'] }),
  });

  const callbackPlatform = searchParams.get('platform');
  const callbackResult = searchParams.get('result');

  const dismissCallbackBanner = () => {
    searchParams.delete('platform');
    searchParams.delete('result');
    setSearchParams(searchParams, { replace: true });
  };

  if (isLoading) return <Spinner />;

  const accounts = data?.data ?? [];
  const byPlatform = new Map(accounts.map((a) => [a.platform, a]));
  const hasAnyConnected = accounts.some((a) => a.status === 'connected');

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <CardHeader>
        <CardTitle>Conecte suas redes sociais</CardTitle>
        <CardDescription>
          Conecte pelo menos uma rede para que a Aurora possa calcular sua audiencia real. Voce
          pode continuar com as redes que conseguir conectar agora e adicionar outras depois.
        </CardDescription>
      </CardHeader>

      {error && <Alert variant="error">Nao foi possivel carregar suas conexoes agora.</Alert>}

      {callbackResult && callbackResult !== 'granted' && (
        <Alert variant="warning">
          {(RESULT_MESSAGE[callbackResult] ?? 'Nao foi possivel conectar')}{' '}
          {PLATFORMS.find((p) => p.value === callbackPlatform)?.label ?? callbackPlatform}. Voce pode
          tentar novamente ou seguir em frente com as redes ja conectadas.
          <button onClick={dismissCallbackBanner} className="ml-2 underline">
            Entendi
          </button>
        </Alert>
      )}
      {callbackResult === 'granted' && (
        <Alert variant="success">
          {PLATFORMS.find((p) => p.value === callbackPlatform)?.label ?? callbackPlatform} conectado
          com sucesso.
          <button onClick={dismissCallbackBanner} className="ml-2 underline">
            Entendi
          </button>
        </Alert>
      )}

      <div className="space-y-3">
        {PLATFORMS.map(({ value, label }) => {
          const account = byPlatform.get(value);
          const isConnected = account?.status === 'connected';
          return (
            <Card key={value}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{
                      backgroundColor: isConnected ? 'var(--color-signal-green)' : 'var(--color-border)',
                    }}
                    aria-hidden="true"
                  />
                  <div>
                    <p className="text-sm font-semibold text-text-dark">{label}</p>
                    {account && (
                      <p className="text-xs text-muted font-mono">
                        {account.platform_handle ?? ''}
                        {isConnected
                          ? ` · conectado em ${new Date(account.connected_at).toLocaleDateString('pt-BR')}`
                          : ''}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {account && (
                    <Badge variant={isConnected ? 'success' : 'warning'}>
                      {isConnected ? 'Conectado' : 'Desconectado'}
                    </Badge>
                  )}
                  {isConnected ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => disconnectMutation.mutate(value)}
                      loading={disconnectMutation.isPending}
                    >
                      Desconectar
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => authorizeMutation.mutate(value)}
                      loading={authorizeMutation.isPending}
                    >
                      {account ? 'Reconectar' : 'Conectar'}
                    </Button>
                  )}
                </div>
              </div>
              {account?.status === 'disconnected' && account.disconnect_reason === 'revoked_by_platform' && (
                <p className="text-xs text-error mt-2">
                  A autorizacao foi revogada pela plataforma. Reconecte para continuar recebendo
                  metricas atualizadas.
                </p>
              )}
            </Card>
          );
        })}
      </div>

      {authorizeMutation.isError && (
        <Alert variant="error">
          {isAxiosError(authorizeMutation.error) && authorizeMutation.error.response?.data?.error?.message
            ? authorizeMutation.error.response.data.error.message
            : 'Nao foi possivel iniciar a conexao agora.'}
        </Alert>
      )}

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted">
          {hasAnyConnected ? 'Voce ja pode continuar.' : 'Conecte pelo menos uma rede para continuar.'}
        </p>
        <Button disabled={!hasAnyConnected} onClick={() => navigate('/creator-portal/onboarding/review')}>
          Continuar
        </Button>
      </div>
    </div>
  );
}
