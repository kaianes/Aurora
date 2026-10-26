import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { creatorPortalApi, getCreatorToken } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import type { CreatorSocialAccount, SocialPlatform } from '@/types/api';

const PLATFORMS: { value: SocialPlatform; label: string }[] = [
  { value: 'instagram', label: 'Instagram' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'youtube', label: 'YouTube' },
];

const DISCONNECT_REASON_LABEL: Record<string, string> = {
  revoked_by_platform: 'Acesso revogado pela plataforma',
  refresh_failed: 'Nao foi possivel renovar a autorizacao',
  manual: 'Desconectado manualmente',
};

function AccountRow({ platform, label, account }: { platform: SocialPlatform; label: string; account?: CreatorSocialAccount }) {
  const queryClient = useQueryClient();
  const isConnected = account?.status === 'connected';

  const authorizeMutation = useMutation({
    mutationFn: () => creatorPortalApi.authorizeSocialAccount(platform),
    onSuccess: (data) => {
      window.location.href = data.authorize_url;
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: () => creatorPortalApi.disconnectSocialAccount(platform),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['creator-social-accounts'] }),
  });

  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: isConnected ? 'var(--color-signal-green)' : 'var(--color-border)' }}
            aria-hidden="true"
          />
          <div>
            <p className="text-sm font-semibold text-text-dark">{label}</p>
            {account && (
              <p className="text-xs text-muted font-mono">
                {account.platform_handle ?? ''}
                {isConnected
                  ? ` · conectado em ${new Date(account.connected_at).toLocaleDateString('pt-BR')}`
                  : account.disconnected_at
                    ? ` · desconectado em ${new Date(account.disconnected_at).toLocaleDateString('pt-BR')}`
                    : ''}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {account && <Badge variant={isConnected ? 'success' : 'warning'}>{isConnected ? 'Conectado' : 'Desconectado'}</Badge>}
          {isConnected ? (
            <Button size="sm" variant="outline" onClick={() => disconnectMutation.mutate()} loading={disconnectMutation.isPending}>
              Desconectar
            </Button>
          ) : (
            <Button size="sm" onClick={() => authorizeMutation.mutate()} loading={authorizeMutation.isPending}>
              {account ? 'Reconectar' : 'Conectar'}
            </Button>
          )}
        </div>
      </div>

      {account?.status === 'disconnected' && account.disconnect_reason && (
        <Alert variant={account.disconnect_reason === 'manual' ? 'info' : 'warning'} className="mt-3">
          {DISCONNECT_REASON_LABEL[account.disconnect_reason] ?? account.disconnect_reason}
          {account.disconnect_reason !== 'manual' && ' -- reconecte para voltar a receber metricas atualizadas.'}
        </Alert>
      )}

      {authorizeMutation.isError && (
        <Alert variant="error" className="mt-3">
          {isAxiosError(authorizeMutation.error) && authorizeMutation.error.response?.data?.error?.message
            ? authorizeMutation.error.response.data.error.message
            : 'Nao foi possivel iniciar a conexao agora.'}
        </Alert>
      )}
    </Card>
  );
}

/**
 * Ongoing connection management (US-24.1 scenario 2): when a platform-side revocation
 * flips a connection to disconnected, she sees it here plainly and is prompted to
 * relink, without losing any other data already on her profile. Per
 * docs/architecture/e8-creator-recruitment-growth.md section 5.5-5.6.
 */
export function SocialAccountsPage() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!getCreatorToken()) {
      navigate('/creator-portal/login');
    }
  }, [navigate]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['creator-social-accounts'],
    queryFn: () => creatorPortalApi.listSocialAccounts(),
  });

  if (isLoading) return <Spinner />;

  const accounts = data?.data ?? [];
  const byPlatform = new Map(accounts.map((a) => [a.platform, a]));

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <CardHeader>
        <CardTitle>Suas redes conectadas</CardTitle>
        <CardDescription>Gerencie as redes sociais ligadas ao seu perfil.</CardDescription>
      </CardHeader>

      {error && <Alert variant="error">Nao foi possivel carregar suas conexoes agora.</Alert>}

      <div className="space-y-3">
        {PLATFORMS.map(({ value, label }) => (
          <AccountRow key={value} platform={value} label={label} account={byPlatform.get(value)} />
        ))}
      </div>
    </div>
  );
}
