import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { creatorPortalApi } from '@/lib/api-client';
import { CREATOR_TERMS_VERSION } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';

const registerSchema = z.object({
  name: z.string().min(2, 'Nome deve ter pelo menos 2 caracteres').max(100),
  email: z.string().email('Email invalido'),
  password: z
    .string()
    .min(10, 'Senha deve ter pelo menos 10 caracteres')
    .regex(/[A-Z]/, 'Deve conter pelo menos uma letra maiuscula')
    .regex(/[a-z]/, 'Deve conter pelo menos uma letra minuscula')
    .regex(/[0-9]/, 'Deve conter pelo menos um numero')
    .regex(/[^A-Za-z0-9]/, 'Deve conter pelo menos um caractere especial'),
  accepted_terms: z.literal(true, {
    errorMap: () => ({ message: 'Voce precisa aceitar os termos para continuar' }),
  }),
});

type RegisterForm = z.infer<typeof registerSchema>;

/**
 * Duda's self-registration (US-24.1 step 1 of the 5-step onboarding flow, NFR-24), per
 * docs/architecture/e8-creator-recruitment-growth.md section 5.1. A claimed profile
 * (US-23.2) skips this screen entirely -- her account already exists by the time she
 * reaches step 2.
 */
export function RegisterPage() {
  const [success, setSuccess] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterForm>({
    resolver: zodResolver(registerSchema),
  });

  const mutation = useMutation({
    mutationFn: (data: RegisterForm) =>
      creatorPortalApi.register({ ...data, terms_version: CREATOR_TERMS_VERSION }),
    onSuccess: () => setSuccess(true),
  });

  const onSubmit = (data: RegisterForm) => {
    mutation.mutate(data);
  };

  const apiError = mutation.error;
  const errorMessage =
    apiError && isAxiosError(apiError) && apiError.response?.data?.error?.message
      ? apiError.response.data.error.message
      : apiError
        ? 'Ocorreu um erro. Tente novamente.'
        : null;

  if (success) {
    return (
      <div className="flex min-h-[80vh] items-center justify-center px-4">
        <Card className="w-full max-w-md text-center">
          <div className="mb-4 text-4xl" aria-hidden="true">&#9993;</div>
          <h1 className="text-xl font-semibold text-text-dark mb-2">Verifique seu email</h1>
          <p className="text-sm text-muted">
            Enviamos um link de verificacao para o seu email. Depois de confirmar, conecte suas
            redes sociais para comecar a receber oportunidades.
          </p>
          <Link to="/creator-portal/login" className="mt-4 inline-block text-sm text-primary hover:underline">
            Ir para o login
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-[80vh] items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <h1 className="text-xl font-semibold text-text-dark mb-1">Criar conta de criadora</h1>
        <p className="text-sm text-muted mb-6">
          Cadastre-se para conectar suas redes e comecar a receber oportunidades de marcas.
        </p>

        {errorMessage && (
          <Alert variant="error" className="mb-4">
            {errorMessage}
          </Alert>
        )}

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          <Input
            label="Nome completo"
            {...register('name')}
            error={errors.name?.message}
            autoComplete="name"
          />
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
            hint="Minimo 10 caracteres, com maiuscula, minuscula, numero e caractere especial"
            autoComplete="new-password"
          />
          <div>
            <label className="flex items-start gap-2 text-sm text-text-dark">
              <input type="checkbox" className="mt-0.5" {...register('accepted_terms')} />
              <span>Li e aceito os termos de uso da Aurora.</span>
            </label>
            {errors.accepted_terms && (
              <p className="text-sm text-error mt-1" role="alert">
                {errors.accepted_terms.message}
              </p>
            )}
          </div>

          <Button type="submit" loading={mutation.isPending} className="w-full">
            Criar conta
          </Button>
        </form>

        <p className="mt-4 text-center text-sm text-muted">
          Ja tem uma conta?{' '}
          <Link to="/creator-portal/login" className="text-primary hover:underline">
            Entrar
          </Link>
        </p>
      </Card>
    </div>
  );
}
