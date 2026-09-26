import { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { authApi } from '@/lib/api-client';
import { useAuth } from '@/contexts/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { useEffect } from 'react';

export function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { login } = useAuth();
  const token = searchParams.get('token');

  const [expired, setExpired] = useState(false);
  const [resendEmail, setResendEmail] = useState('');
  const [resendSuccess, setResendSuccess] = useState(false);

  const verifyMutation = useMutation({
    mutationFn: authApi.verifyEmail,
    onSuccess: (data) => {
      // Auto-login after email verification
      login(data.access_token, data.refresh_token, {
        id: '',
        email: '',
        name: '',
        mfa_enabled: false,
      }, []);
      navigate('/app/brand-profile');
    },
    onError: (error) => {
      if (isAxiosError(error) && error.response?.data?.error?.code === 'VERIFICATION_EXPIRED') {
        setExpired(true);
      }
    },
  });

  const resendMutation = useMutation({
    mutationFn: authApi.resendVerification,
    onSuccess: () => setResendSuccess(true),
  });

  useEffect(() => {
    if (token && !verifyMutation.isSuccess && !verifyMutation.isError) {
      verifyMutation.mutate({ token });
    }
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!token) {
    return (
      <div className="flex min-h-[80vh] items-center justify-center px-4">
        <Card className="w-full max-w-md text-center">
          <Alert variant="error">Token de verificacao ausente. Verifique o link do email.</Alert>
        </Card>
      </div>
    );
  }

  if (verifyMutation.isPending) {
    return (
      <div className="flex min-h-[80vh] items-center justify-center">
        <div className="text-center">
          <Spinner />
          <p className="mt-2 text-sm text-muted">Verificando seu email...</p>
        </div>
      </div>
    );
  }

  if (expired) {
    return (
      <div className="flex min-h-[80vh] items-center justify-center px-4">
        <Card className="w-full max-w-md">
          <h1 className="text-xl font-semibold text-text-dark mb-2">Link expirado</h1>
          <p className="text-sm text-muted mb-4">
            O link de verificacao expirou. Informe seu email para receber um novo link.
          </p>

          {resendSuccess ? (
            <Alert variant="success">
              Se este email estiver cadastrado, um novo link de verificacao sera enviado.
            </Alert>
          ) : (
            <div className="space-y-3">
              <Input
                label="Email"
                type="email"
                value={resendEmail}
                onChange={(e) => setResendEmail(e.target.value)}
                autoComplete="email"
              />
              <Button
                onClick={() => resendMutation.mutate({ email: resendEmail })}
                loading={resendMutation.isPending}
                disabled={!resendEmail}
                className="w-full"
              >
                Reenviar email de verificacao
              </Button>
            </div>
          )}
        </Card>
      </div>
    );
  }

  if (verifyMutation.isError && !expired) {
    const errorMsg =
      isAxiosError(verifyMutation.error) && verifyMutation.error.response?.data?.error?.message
        ? verifyMutation.error.response.data.error.message
        : 'Nao foi possivel verificar o email. O link pode ser invalido ou ja ter sido utilizado.';

    return (
      <div className="flex min-h-[80vh] items-center justify-center px-4">
        <Card className="w-full max-w-md text-center">
          <Alert variant="error">{errorMsg}</Alert>
        </Card>
      </div>
    );
  }

  return null;
}
