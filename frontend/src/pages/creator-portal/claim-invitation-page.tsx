import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { creatorPortalApi, setCreatorToken } from '@/lib/api-client';
import { CREATOR_TERMS_VERSION } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';

const claimSchema = z.object({
  email: z.string().email('Email invalido'),
  password: z
    .string()
    .min(10, 'Senha deve ter pelo menos 10 caracteres')
    .regex(/[A-Z]/, 'Deve conter pelo menos uma letra maiuscula')
    .regex(/[a-z]/, 'Deve conter pelo menos uma letra minuscula')
    .regex(/[0-9]/, 'Deve conter pelo menos um numero')
    .regex(/[^A-Za-z0-9]/, 'Deve conter pelo menos um caractere especial'),
  display_name: z.string().min(1, 'Informe seu nome de exibicao'),
  content_niche: z.string().optional(),
  accepted_terms: z.literal(true, {
    errorMap: () => ({ message: 'Voce precisa aceitar os termos para continuar' }),
  }),
});

type ClaimForm = z.infer<typeof claimSchema>;

/**
 * Duda's invitation claim flow (US-23.2): she is shown exactly what Aurora observed about
 * her publicly, can correct any field before it goes live, and the profile only activates
 * after she confirms -- or she can decline outright and everything imported is deleted.
 * Per docs/architecture/e8-creator-recruitment-growth.md section 4.3-4.5.
 */
export function ClaimInvitationPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [declined, setDeclined] = useState(false);

  const { data: invitation, isLoading, error } = useQuery({
    queryKey: ['creator-invitation', token],
    queryFn: () => creatorPortalApi.getInvitation(token!),
    enabled: !!token,
    retry: false,
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ClaimForm>({
    resolver: zodResolver(claimSchema),
    defaultValues: { email: '', password: '', display_name: '', content_niche: '' },
  });

  // react-hook-form's defaultValues is only read once, at mount -- the invitation preview
  // has not loaded yet at that point, so the surfaced fields are synced in with reset()
  // once it arrives.
  useEffect(() => {
    if (invitation) {
      reset({
        email: '',
        password: '',
        display_name: invitation.imported_data.display_name,
        content_niche: invitation.imported_data.observed_niche ?? '',
      });
    }
  }, [invitation, reset]);

  const confirmMutation = useMutation({
    mutationFn: (data: ClaimForm) =>
      creatorPortalApi.confirmInvitation(token!, {
        email: data.email,
        password: data.password,
        corrections: {
          display_name: data.display_name,
          content_niche: data.content_niche || undefined,
        },
        accepted_terms: data.accepted_terms,
        terms_version: CREATOR_TERMS_VERSION,
      }),
    onSuccess: (data) => {
      setCreatorToken(data.access_token);
      navigate('/creator-portal/onboarding/link-accounts');
    },
  });

  const declineMutation = useMutation({
    mutationFn: () => creatorPortalApi.declineInvitation(token!),
    onSuccess: () => setDeclined(true),
  });

  if (!token) {
    return (
      <div className="mx-auto max-w-md">
        <Card>
          <Alert variant="error">Link de convite invalido.</Alert>
        </Card>
      </div>
    );
  }

  if (isLoading) return <Spinner />;

  if (declined) {
    return (
      <div className="mx-auto max-w-md">
        <Card className="text-center">
          <h1 className="text-xl font-semibold text-text-dark mb-2">Convite recusado</h1>
          <p className="text-sm text-muted">
            Tudo bem. Removemos os dados que havíamos importado sobre voce e nao entraremos em
            contato novamente sobre este convite.
          </p>
        </Card>
      </div>
    );
  }

  if (error || !invitation) {
    const code = isAxiosError(error) ? error.response?.data?.error?.code : null;
    const message =
      code === 'INVITATION_EXPIRED'
        ? 'Este convite expirou ou ja foi respondido.'
        : isAxiosError(error) && error.response?.data?.error?.message
          ? error.response.data.error.message
          : 'Nao foi possivel encontrar este convite.';
    return (
      <div className="mx-auto max-w-md">
        <Card>
          <Alert variant="error">{message}</Alert>
        </Card>
      </div>
    );
  }

  const imported = invitation.imported_data;
  const confirmError = confirmMutation.error;
  const confirmErrorMessage =
    confirmError && isAxiosError(confirmError) && confirmError.response?.data?.error?.message
      ? confirmError.response.data.error.message
      : confirmError
        ? 'Nao foi possivel confirmar seu cadastro agora.'
        : null;

  const onSubmit = (data: ClaimForm) => confirmMutation.mutate(data);

  return (
    <div className="mx-auto max-w-lg space-y-6">
      {/* Creator Pink marks creator-energy moments -- the invitation is the first time
          Aurora shows Duda something built about her, before she has agreed to anything. */}
      <div className="h-1 rounded-full" style={{ backgroundColor: 'var(--color-creator-pink)' }} aria-hidden="true" />

      <CardHeader>
        <CardTitle>Voce foi convidada para a Aurora</CardTitle>
        <CardDescription>
          Reunimos estas informacoes publicas sobre voce. Revise, corrija o que estiver errado, e
          confirme para ativar seu perfil -- ou recuse se preferir que nada disso vá adiante.
        </CardDescription>
      </CardHeader>

      <Card>
        <h3 className="text-sm font-semibold text-text-dark mb-3">O que encontramos publicamente</h3>
        <dl className="space-y-1.5 font-mono text-sm text-text-dark">
          <div className="flex justify-between">
            <dt className="text-muted">Plataforma</dt>
            <dd>{imported.platform ?? '-'}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">Usuario observado</dt>
            <dd>{imported.observed_handle ?? '-'}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">Seguidores observados</dt>
            <dd>{imported.observed_follower_count?.toLocaleString('pt-BR') ?? '-'}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">Nicho observado</dt>
            <dd>{imported.observed_niche ?? '-'}</dd>
          </div>
        </dl>
        <p className="text-xs text-muted mt-3">
          Campos nao observados ficam em branco -- nunca estimamos um valor que nao verificamos.
        </p>
      </Card>

      <Card>
        <h3 className="text-sm font-semibold text-text-dark mb-3">Corrija o que precisar e crie sua senha</h3>
        {confirmErrorMessage && (
          <Alert variant="error" className="mb-4">
            {confirmErrorMessage}
          </Alert>
        )}
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          <Input
            label="Nome de exibicao"
            {...register('display_name')}
            error={errors.display_name?.message}
          />
          <Input
            label="Nicho de conteudo"
            {...register('content_niche')}
            error={errors.content_niche?.message}
          />
          <Input
            label="Seu email"
            type="email"
            {...register('email')}
            error={errors.email?.message}
            autoComplete="email"
          />
          <Input
            label="Crie uma senha"
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

          <div className="flex gap-2">
            <Button type="submit" loading={confirmMutation.isPending} className="flex-1">
              Confirmar e ativar meu perfil
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => declineMutation.mutate()}
              loading={declineMutation.isPending}
            >
              Recusar
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
