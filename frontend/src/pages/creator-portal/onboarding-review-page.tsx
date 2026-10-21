import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useMutation } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { creatorPortalApi, getCreatorToken } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

interface ReviewForm {
  display_name: string;
  content_niche: string;
}

/**
 * Onboarding step 3 (US-24.1, section 5 step table row 3): review/correct the display
 * name and niche before the automatic analysis runs. The architecture document specifies
 * only the PATCH /creator-portal/profile call here, no GET to prefill current values --
 * fields start blank rather than fabricating a prior value the frontend has no way to
 * read. Both fields are optional; only ones she actually fills in are sent, so an
 * untouched field is never overwritten with an empty string.
 */
export function OnboardingReviewPage() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!getCreatorToken()) {
      navigate('/creator-portal/login');
    }
  }, [navigate]);

  const { register, handleSubmit } = useForm<ReviewForm>({
    defaultValues: { display_name: '', content_niche: '' },
  });

  const mutation = useMutation({
    mutationFn: (data: ReviewForm) => {
      const corrections: { display_name?: string; content_niche?: string } = {};
      if (data.display_name.trim()) corrections.display_name = data.display_name.trim();
      if (data.content_niche.trim()) corrections.content_niche = data.content_niche.trim();
      return creatorPortalApi.updateProfile(corrections);
    },
    onSuccess: () => navigate('/creator-portal/onboarding/analyzing'),
  });

  const onSubmit = (data: ReviewForm) => mutation.mutate(data);

  const errorMessage =
    mutation.error && isAxiosError(mutation.error) && mutation.error.response?.data?.error?.message
      ? mutation.error.response.data.error.message
      : mutation.isError
        ? 'Nao foi possivel salvar agora. Voce pode tentar novamente ou pular esta etapa.'
        : null;

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <CardHeader>
        <CardTitle>Revise seu perfil</CardTitle>
        <CardDescription>
          Confira ou ajuste seu nome de exibicao e nicho de conteudo. Isso aparece para as marcas
          junto com suas metricas reais.
        </CardDescription>
      </CardHeader>

      <Card>
        {errorMessage && (
          <Alert variant="error" className="mb-4">
            {errorMessage}
          </Alert>
        )}
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          <Input label="Nome de exibicao" {...register('display_name')} placeholder="Como voce quer aparecer" />
          <Input label="Nicho de conteudo" {...register('content_niche')} placeholder="Ex: skincare e maquiagem" />

          <div className="flex gap-2">
            <Button type="submit" loading={mutation.isPending} className="flex-1">
              Continuar
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => navigate('/creator-portal/onboarding/analyzing')}
            >
              Pular
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
