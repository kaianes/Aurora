import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { authApi } from '@/lib/api-client';
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
  workspace_name: z.string().min(2, 'Nome do workspace deve ter pelo menos 2 caracteres').max(100),
  workspace_type: z.enum(['brand', 'agency']),
});

type RegisterForm = z.infer<typeof registerSchema>;

export function RegisterPage() {
  const [success, setSuccess] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<RegisterForm>({
    resolver: zodResolver(registerSchema),
    defaultValues: { workspace_type: 'brand' },
  });

  const workspaceType = watch('workspace_type');

  const mutation = useMutation({
    mutationFn: authApi.register,
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

  const fieldErrors =
    apiError && isAxiosError(apiError) && apiError.response?.data?.error?.details
      ? (apiError.response.data.error.details as Record<string, string[]>)
      : null;

  if (success) {
    return (
      <div className="flex min-h-[80vh] items-center justify-center px-4">
        <Card className="w-full max-w-md text-center">
          <div className="mb-4 text-4xl" aria-hidden="true">&#9993;</div>
          <h1 className="text-xl font-semibold text-text-dark mb-2">Verifique seu email</h1>
          <p className="text-sm text-muted">
            Enviamos um link de verificacao para o seu email. Clique no link para ativar sua conta.
          </p>
          <Link to="/login" className="mt-4 inline-block text-sm text-primary hover:underline">
            Ir para o login
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-[80vh] items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <h1 className="text-xl font-semibold text-text-dark mb-1">Criar conta</h1>
        <p className="text-sm text-muted mb-6">Comece a usar a Aurora sem precisar falar com vendas.</p>

        {errorMessage && (
          <Alert variant="error" className="mb-4">
            {errorMessage}
          </Alert>
        )}

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          {/* Workspace type toggle */}
          <fieldset>
            <legend className="block text-sm font-medium text-text-dark mb-2">Tipo de workspace</legend>
            <div className="flex rounded-lg border border-border overflow-hidden">
              <button
                type="button"
                onClick={() => setValue('workspace_type', 'brand')}
                className={`flex-1 py-2 text-sm font-medium transition-colors ${
                  workspaceType === 'brand'
                    ? 'bg-primary text-white'
                    : 'bg-white text-muted hover:bg-surface'
                }`}
                aria-pressed={workspaceType === 'brand'}
              >
                Marca
              </button>
              <button
                type="button"
                onClick={() => setValue('workspace_type', 'agency')}
                className={`flex-1 py-2 text-sm font-medium transition-colors ${
                  workspaceType === 'agency'
                    ? 'bg-primary text-white'
                    : 'bg-white text-muted hover:bg-surface'
                }`}
                aria-pressed={workspaceType === 'agency'}
              >
                Agencia
              </button>
            </div>
          </fieldset>

          <Input
            label="Nome completo"
            {...register('name')}
            error={errors.name?.message ?? fieldErrors?.name?.[0]}
            autoComplete="name"
          />
          <Input
            label="Email"
            type="email"
            {...register('email')}
            error={errors.email?.message ?? fieldErrors?.email?.[0]}
            autoComplete="email"
          />
          <Input
            label="Senha"
            type="password"
            {...register('password')}
            error={errors.password?.message ?? fieldErrors?.password?.[0]}
            hint="Minimo 10 caracteres, com maiuscula, minuscula, numero e caractere especial"
            autoComplete="new-password"
          />
          <Input
            label={workspaceType === 'brand' ? 'Nome da marca' : 'Nome da agencia'}
            {...register('workspace_name')}
            error={errors.workspace_name?.message ?? fieldErrors?.workspace_name?.[0]}
          />

          <Button type="submit" loading={mutation.isPending} className="w-full">
            Criar conta
          </Button>
        </form>

        <p className="mt-4 text-center text-sm text-muted">
          Ja tem uma conta?{' '}
          <Link to="/login" className="text-primary hover:underline">
            Entrar
          </Link>
        </p>
      </Card>
    </div>
  );
}
