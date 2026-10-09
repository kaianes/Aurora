import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { authApi } from '@/lib/api-client';
import { useAuth } from '@/contexts/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';

const loginSchema = z.object({
  email: z.string().email('Email invalido'),
  password: z.string().min(1, 'Senha e obrigatoria'),
});

type LoginForm = z.infer<typeof loginSchema>;

export function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaCode, setMfaCode] = useState('');
  const [loginData, setLoginData] = useState<LoginForm | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  });

  const mutation = useMutation({
    mutationFn: authApi.login,
    onSuccess: (data) => {
      login(data.access_token, data.refresh_token, data.user, data.memberships);
      navigate('/app/brand-profile');
    },
    onError: (error) => {
      if (isAxiosError(error) && error.response?.data?.error?.code === 'MFA_REQUIRED') {
        setMfaRequired(true);
      }
    },
  });

  const onSubmit = (data: LoginForm) => {
    if (mfaRequired && loginData) {
      mutation.mutate({ ...loginData, mfa_code: mfaCode });
    } else {
      setLoginData(data);
      mutation.mutate(data);
    }
  };

  const handleMfaSubmit = () => {
    if (loginData && mfaCode) {
      mutation.mutate({ ...loginData, mfa_code: mfaCode });
    }
  };

  const apiError = mutation.error;
  const errorCode = isAxiosError(apiError) ? apiError.response?.data?.error?.code : null;
  const errorMessage =
    apiError && isAxiosError(apiError) && apiError.response?.data?.error?.message
      ? apiError.response.data.error.message
      : apiError && errorCode !== 'MFA_REQUIRED'
        ? 'Credenciais invalidas. Tente novamente.'
        : null;

  const isEmailNotVerified = errorCode === 'EMAIL_NOT_VERIFIED';

  return (
    <div className="flex min-h-[80vh] items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <h1 className="text-xl font-semibold text-text-dark mb-1">Entrar</h1>
        <p className="text-sm text-muted mb-6">Acesse sua conta Aurora.</p>

        {errorMessage && !mfaRequired && (
          <Alert variant="error" className="mb-4">
            {errorMessage}
            {isEmailNotVerified && (
              <span className="block mt-1">
                Verifique seu email antes de fazer login.
              </span>
            )}
          </Alert>
        )}

        {!mfaRequired ? (
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            <Input
              label="Email"
              type="email"
              {...register('email')}
              error={errors.email?.message}
              autoComplete="email"
            />
            <Input
              label="Senha"
              type="password"
              {...register('password')}
              error={errors.password?.message}
              autoComplete="current-password"
            />
            <Button type="submit" loading={mutation.isPending} className="w-full">
              Entrar
            </Button>
          </form>
        ) : (
          <div className="space-y-4">
            <Alert variant="info">
              Sua conta tem autenticacao de dois fatores ativada. Insira o codigo do seu aplicativo autenticador.
            </Alert>
            <Input
              label="Codigo MFA"
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value)}
              placeholder="000000"
              maxLength={6}
              autoComplete="one-time-code"
              inputMode="numeric"
            />
            {errorMessage && (
              <Alert variant="error">{errorMessage}</Alert>
            )}
            <Button onClick={handleMfaSubmit} loading={mutation.isPending} className="w-full">
              Verificar
            </Button>
          </div>
        )}

        <p className="mt-4 text-center text-sm text-muted">
          Nao tem uma conta?{' '}
          <Link to="/register" className="text-primary hover:underline">
            Criar conta
          </Link>
        </p>
      </Card>
    </div>
  );
}
