import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { creatorPortalApi, setCreatorToken } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';

/**
 * Lands the creator-specific verification link (section 5.2: POST
 * /creator-portal/verify-email, distinct from E1's brand-side endpoint). Not listed
 * explicitly in the architecture's frontend route map (section 10), but required for
 * that endpoint to be reachable from the email it is sent in.
 */
export function CreatorVerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token');
  const [attempted, setAttempted] = useState(false);

  const verifyMutation = useMutation({
    mutationFn: creatorPortalApi.verifyEmail,
    onSuccess: (data) => {
      setCreatorToken(data.access_token);
      navigate('/creator-portal/onboarding/link-accounts');
    },
  });

  useEffect(() => {
    if (token && !attempted) {
      setAttempted(true);
      verifyMutation.mutate({ token });
    }
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (!token) {
    return (
      <div className="mx-auto max-w-md">
        <Card>
          <Alert variant="error">Token de verificacao ausente. Verifique o link do email.</Alert>
        </Card>
      </div>
    );
  }

  if (verifyMutation.isPending || !verifyMutation.isError) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <Spinner />
          <p className="mt-2 text-sm text-muted">Verificando seu email...</p>
        </div>
      </div>
    );
  }

  const errorMessage =
    isAxiosError(verifyMutation.error) && verifyMutation.error.response?.data?.error?.message
      ? verifyMutation.error.response.data.error.message
      : 'Nao foi possivel verificar o email. O link pode ser invalido ou ja ter sido utilizado.';

  return (
    <div className="mx-auto max-w-md">
      <Card className="text-center">
        <Alert variant="error">{errorMessage}</Alert>
        <Button className="mt-4" onClick={() => navigate('/creator-portal/login')}>
          Ir para o login
        </Button>
        <p className="mt-2 text-sm text-muted">
          <Link to="/creator-portal/register" className="text-primary hover:underline">
            Criar uma nova conta
          </Link>
        </p>
      </Card>
    </div>
  );
}
