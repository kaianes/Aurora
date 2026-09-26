import { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { invitationApi } from '@/lib/api-client';
import { useAuth } from '@/contexts/auth-context';
import { getAccessToken } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';

const newUserSchema = z.object({
  name: z.string().min(2, 'Nome deve ter pelo menos 2 caracteres').max(100),
  password: z
    .string()
    .min(10, 'Senha deve ter pelo menos 10 caracteres')
    .regex(/[A-Z]/, 'Deve conter pelo menos uma letra maiuscula')
    .regex(/[a-z]/, 'Deve conter pelo menos uma letra minuscula')
    .regex(/[0-9]/, 'Deve conter pelo menos um numero')
    .regex(/[^A-Za-z0-9]/, 'Deve conter pelo menos um caractere especial'),
});

type NewUserForm = z.infer<typeof newUserSchema>;

export function AcceptInvitationPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const token = searchParams.get('token');
  const [accepted, setAccepted] = useState(false);

  const isExistingUser = isAuthenticated || !!getAccessToken();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<NewUserForm>({
    resolver: zodResolver(newUserSchema),
  });

  const mutation = useMutation({
    mutationFn: invitationApi.accept,
    onSuccess: () => setAccepted(true),
  });

  if (!token) {
    return (
      <div className="flex min-h-[80vh] items-center justify-center px-4">
        <Card className="w-full max-w-md text-center">
          <Alert variant="error">Token de convite ausente. Verifique o link do email.</Alert>
        </Card>
      </div>
    );
  }

  if (accepted) {
    return (
      <div className="flex min-h-[80vh] items-center justify-center px-4">
        <Card className="w-full max-w-md text-center">
          <h1 className="text-xl font-semibold text-text-dark mb-2">Convite aceito!</h1>
          <p className="text-sm text-muted mb-4">
            Voce agora faz parte do workspace. Faca login para comecar.
          </p>
          <Button onClick={() => navigate('/login')}>Ir para o login</Button>
        </Card>
      </div>
    );
  }

  const apiError = mutation.error;
  const errorMessage =
    apiError && isAxiosError(apiError) && apiError.response?.data?.error?.message
      ? apiError.response.data.error.message
      : apiError
        ? 'Nao foi possivel aceitar o convite. Tente novamente.'
        : null;

  // Existing user: just confirm
  if (isExistingUser) {
    return (
      <div className="flex min-h-[80vh] items-center justify-center px-4">
        <Card className="w-full max-w-md">
          <h1 className="text-xl font-semibold text-text-dark mb-2">Aceitar convite</h1>
          <p className="text-sm text-muted mb-4">
            Voce foi convidado para um workspace na Aurora. Clique abaixo para aceitar.
          </p>
          {errorMessage && <Alert variant="error" className="mb-4">{errorMessage}</Alert>}
          <Button
            onClick={() => mutation.mutate({ token })}
            loading={mutation.isPending}
            className="w-full"
          >
            Aceitar convite
          </Button>
        </Card>
      </div>
    );
  }

  // New user: registration form
  const onSubmit = (data: NewUserForm) => {
    mutation.mutate({ token, ...data });
  };

  return (
    <div className="flex min-h-[80vh] items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <h1 className="text-xl font-semibold text-text-dark mb-1">Aceitar convite</h1>
        <p className="text-sm text-muted mb-6">
          Crie sua conta para aceitar o convite e acessar o workspace.
        </p>

        {errorMessage && <Alert variant="error" className="mb-4">{errorMessage}</Alert>}

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          <Input
            label="Nome completo"
            {...register('name')}
            error={errors.name?.message}
            autoComplete="name"
          />
          <Input
            label="Senha"
            type="password"
            {...register('password')}
            error={errors.password?.message}
            hint="Minimo 10 caracteres, com maiuscula, minuscula, numero e caractere especial"
            autoComplete="new-password"
          />
          <Button type="submit" loading={mutation.isPending} className="w-full">
            Criar conta e aceitar convite
          </Button>
        </form>
      </Card>
    </div>
  );
}
