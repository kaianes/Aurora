import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { QRCodeSVG } from 'qrcode.react';
import { authApi } from '@/lib/api-client';
import { useAuth } from '@/contexts/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import type { MfaSetupResponse } from '@/types/api';

export function SecurityPage() {
  const { user, updateUser } = useAuth();
  const [setupData, setSetupData] = useState<MfaSetupResponse | null>(null);
  const [code, setCode] = useState('');
  const [justEnabled, setJustEnabled] = useState(false);

  const setupMutation = useMutation({
    mutationFn: authApi.mfaSetup,
    onSuccess: (data) => {
      setSetupData(data);
      setCode('');
    },
  });

  const confirmMutation = useMutation({
    mutationFn: (data: { code: string }) => authApi.mfaConfirm(data),
    onSuccess: () => {
      updateUser({ mfa_enabled: true });
      setSetupData(null);
      setCode('');
      setJustEnabled(true);
    },
  });

  const setupError = setupMutation.error;
  const setupErrorMessage =
    setupError && isAxiosError(setupError) && setupError.response?.data?.error?.message
      ? setupError.response.data.error.message
      : setupError
        ? 'Nao foi possivel iniciar a configuracao do MFA.'
        : null;

  const confirmError = confirmMutation.error;
  const confirmErrorMessage =
    confirmError && isAxiosError(confirmError) && confirmError.response?.data?.error?.message
      ? confirmError.response.data.error.message
      : confirmError
        ? 'Nao foi possivel confirmar o codigo.'
        : null;

  const mfaEnabled = user?.mfa_enabled ?? false;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <CardHeader>
        <CardTitle>Seguranca</CardTitle>
        <CardDescription>Gerencie a autenticacao de dois fatores (MFA) da sua conta.</CardDescription>
      </CardHeader>

      {justEnabled && (
        <Alert variant="success">MFA ativado com sucesso.</Alert>
      )}

      <Card>
        <h3 className="text-sm font-semibold text-text-dark mb-3">Autenticacao de dois fatores</h3>

        {mfaEnabled ? (
          <Alert variant="success">MFA esta ativado na sua conta.</Alert>
        ) : setupData ? (
          <div className="space-y-4">
            <p className="text-sm text-muted">
              Escaneie o QR code abaixo com um aplicativo autenticador (Google Authenticator, Authy, etc.)
              e digite o codigo gerado para confirmar.
            </p>

            <div className="flex justify-center rounded-lg border border-border bg-white p-4">
              <QRCodeSVG value={setupData.qr_code_url} size={192} />
            </div>

            <div>
              <p className="text-xs text-muted mb-1">Nao consegue escanear? Digite o codigo manualmente:</p>
              <code className="block rounded bg-surface px-3 py-2 text-sm font-mono break-all">
                {setupData.secret}
              </code>
            </div>

            <div>
              <p className="text-xs text-muted mb-1">
                Codigos de backup (guarde em um lugar seguro, cada um pode ser usado uma vez):
              </p>
              <div className="grid grid-cols-2 gap-1 rounded bg-surface px-3 py-2 font-mono text-sm">
                {setupData.backup_codes.map((bc) => (
                  <span key={bc}>{bc}</span>
                ))}
              </div>
            </div>

            {confirmErrorMessage && <Alert variant="error">{confirmErrorMessage}</Alert>}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                confirmMutation.mutate({ code });
              }}
              noValidate
              className="flex flex-col sm:flex-row gap-3"
            >
              <div className="flex-1">
                <Input
                  label="Codigo de verificacao"
                  placeholder="123456"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                />
              </div>
              <div className="flex items-end">
                <Button type="submit" loading={confirmMutation.isPending} disabled={!code}>
                  Confirmar
                </Button>
              </div>
            </form>

            <Button variant="ghost" size="sm" onClick={() => setSetupData(null)}>
              Cancelar
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted">
              MFA nao esta ativado na sua conta. Ative para aumentar a seguranca do seu login.
            </p>
            {setupErrorMessage && <Alert variant="error">{setupErrorMessage}</Alert>}
            <Button onClick={() => setupMutation.mutate()} loading={setupMutation.isPending}>
              Ativar MFA
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
