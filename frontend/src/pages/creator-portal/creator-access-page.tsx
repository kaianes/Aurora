import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { creatorPortalApi, setCreatorToken } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';

const loginSchema = z.object({
  email: z.string().email('Email invalido'),
  password: z.string().min(1, 'Senha e obrigatoria'),
});

type LoginForm = z.infer<typeof loginSchema>;

/**
 * Duda's real login (US-24.1), per docs/architecture/e8-creator-recruitment-growth.md
 * section 5.2: identical semantics to E1's brand login, reused unchanged, except the
 * issued JWT carries creator_id instead of memberships -- and no MFA branch, since
 * creators hold no financial-privilege role under FR-04. This replaces the pilot-only
 * creator_id-only stub (ADR-0050) that lived at this same route and file.
 */
export function CreatorAccessPage() {
  const navigate = useNavigate();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  });

  const mutation = useMutation({
    mutationFn: creatorPortalApi.login,
    onSuccess: (data) => {
      setCreatorToken(data.access_token);
      navigate('/creator-portal/opportunities');
    },
  });

  const onSubmit = (data: LoginForm) => {
    mutation.mutate(data);
  };

  const apiError = mutation.error;
  const errorCode = isAxiosError(apiError) ? apiError.response?.data?.error?.code : null;
  const errorMessage =
    apiError && isAxiosError(apiError) && apiError.response?.data?.error?.message
      ? apiError.response.data.error.message
      : apiError
        ? 'Credenciais invalidas. Tente novamente.'
        : null;
  const isEmailNotVerified = errorCode === 'EMAIL_NOT_VERIFIED';

  return (
    <div className="mx-auto max-w-md space-y-6">
      <Card>
        <h1 className="text-xl font-semibold text-text-dark mb-1">Entrar</h1>
        <p className="text-sm text-muted mb-6">Acesse sua conta de criadora na Aurora.</p>

        {errorMessage && (
          <Alert variant="error" className="mb-4">
            {errorMessage}
            {isEmailNotVerified && <span className="block mt-1">Verifique seu email antes de fazer login.</span>}
          </Alert>
        )}

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-3">
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
          <Button type="submit" disabled={mutation.isPending} loading={mutation.isPending} className="w-full">
            Entrar
          </Button>
        </form>

        <p className="mt-4 text-center text-sm text-muted">
          Ainda nao tem conta?{' '}
          <Link to="/creator-portal/register" className="text-primary hover:underline">
            Criar conta
          </Link>
        </p>
      </Card>
    </div>
  );
}
