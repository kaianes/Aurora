import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { brandProfileApi } from '@/lib/api-client';
import { useAuth } from '@/contexts/auth-context';
import { canEditBrandProfile } from '@/lib/roles';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';

const profileSchema = z.object({
  name: z.string().min(1, 'Nome da marca e obrigatorio').max(100),
  tone_of_voice: z.string().optional(),
  content_guidelines: z.string().optional(),
  prohibited_topics_text: z.string().optional(),
});

type ProfileForm = z.infer<typeof profileSchema>;

export function BrandProfilePage() {
  const { currentRole } = useAuth();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const canEdit = currentRole ? canEditBrandProfile(currentRole) : false;

  const { data: profile, isLoading, error: fetchError } = useQuery({
    queryKey: ['brand-profile'],
    queryFn: brandProfileApi.getCurrent,
    retry: (count, error) => {
      if (isAxiosError(error) && error.response?.status === 404) return false;
      return count < 2;
    },
  });

  const isNew = isAxiosError(fetchError) && fetchError.response?.status === 404;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      name: '',
      tone_of_voice: '',
      content_guidelines: '',
      prohibited_topics_text: '',
    },
  });

  useEffect(() => {
    if (profile) {
      reset({
        name: profile.name,
        tone_of_voice: profile.tone_of_voice ?? '',
        content_guidelines: profile.content_guidelines ?? '',
        prohibited_topics_text: profile.prohibited_topics?.join(', ') ?? '',
      });
    }
  }, [profile, reset]);

  const createMutation = useMutation({
    mutationFn: brandProfileApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['brand-profile'] });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof brandProfileApi.update>[1] }) =>
      brandProfileApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['brand-profile'] });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    },
  });

  const logoMutation = useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) => brandProfileApi.uploadLogo(id, file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['brand-profile'] });
    },
  });

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const saveError = createMutation.error ?? updateMutation.error;
  const saveErrorMessage =
    saveError && isAxiosError(saveError) && saveError.response?.data?.error?.message
      ? saveError.response.data.error.message
      : saveError
        ? 'Nao foi possivel salvar o perfil. Tente novamente.'
        : null;

  const logoErrorMessage =
    logoMutation.error && isAxiosError(logoMutation.error) && logoMutation.error.response?.data?.error?.message
      ? logoMutation.error.response.data.error.message
      : logoMutation.error
        ? 'Nao foi possivel enviar o logo. Verifique o formato e tamanho do arquivo (max 5MB, PNG/JPG/SVG/WEBP).'
        : null;

  const onSubmit = (data: ProfileForm) => {
    const topics = data.prohibited_topics_text
      ? data.prohibited_topics_text.split(',').map((t) => t.trim()).filter(Boolean)
      : undefined;

    const payload = {
      name: data.name,
      tone_of_voice: data.tone_of_voice || undefined,
      content_guidelines: data.content_guidelines || undefined,
      prohibited_topics: topics,
    };

    if (profile) {
      updateMutation.mutate({ id: profile.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && profile) {
      logoMutation.mutate({ id: profile.id, file });
    }
  };

  if (isLoading) {
    return <Spinner />;
  }

  if (fetchError && !isNew) {
    return (
      <Alert variant="error">Nao foi possivel carregar o perfil da marca. Tente novamente mais tarde.</Alert>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Perfil da Marca</CardTitle>
            <CardDescription>
              {isNew
                ? 'Configure o perfil da sua marca para que campanhas herdem essas configuracoes.'
                : 'Atualize as informacoes e diretrizes da sua marca.'}
            </CardDescription>
          </div>
          {profile && (
            <Badge variant={profile.status === 'complete' ? 'success' : 'warning'}>
              {profile.status === 'complete' ? 'Completo' : 'Rascunho'}
            </Badge>
          )}
        </div>
      </CardHeader>

      {profile?.status === 'draft' && (
        <Alert variant="warning" className="mb-6">
          O perfil esta incompleto. Campanhas podem ser criadas, mas nao herdarao todas as configuracoes padrao.
        </Alert>
      )}

      {saveSuccess && (
        <Alert variant="success" className="mb-4">Perfil salvo com sucesso.</Alert>
      )}
      {saveErrorMessage && (
        <Alert variant="error" className="mb-4">{saveErrorMessage}</Alert>
      )}

      <Card>
        {/* Logo section */}
        {profile && (
          <div className="mb-6">
            <label className="block text-sm font-medium text-text-dark mb-2">Logo</label>
            <div className="flex items-center gap-4">
              {profile.logo_url ? (
                <img
                  src={profile.logo_url}
                  alt={`Logo de ${profile.name}`}
                  className="h-16 w-16 rounded-lg object-cover border border-border"
                />
              ) : (
                <div className="h-16 w-16 rounded-lg bg-surface border border-border flex items-center justify-center text-muted text-xs">
                  Sem logo
                </div>
              )}
              {canEdit && (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".png,.jpg,.jpeg,.svg,.webp"
                    onChange={handleLogoUpload}
                    className="hidden"
                    aria-label="Enviar logo"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    loading={logoMutation.isPending}
                  >
                    {profile.logo_url ? 'Alterar logo' : 'Enviar logo'}
                  </Button>
                </>
              )}
            </div>
            {logoErrorMessage && (
              <p className="mt-2 text-sm text-error" role="alert">{logoErrorMessage}</p>
            )}
            <p className="mt-1 text-xs text-muted">PNG, JPG, SVG ou WEBP. Maximo 5MB, minimo 200x200px.</p>
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          <Input
            label="Nome da marca"
            {...register('name')}
            error={errors.name?.message}
            disabled={!canEdit}
          />
          <Textarea
            label="Tom de voz"
            {...register('tone_of_voice')}
            error={errors.tone_of_voice?.message}
            placeholder="Ex: Informal, divertido, inclusivo"
            disabled={!canEdit}
          />
          <Textarea
            label="Diretrizes de conteudo"
            {...register('content_guidelines')}
            error={errors.content_guidelines?.message}
            placeholder="Instrucoes para criacao de conteudo da marca..."
            disabled={!canEdit}
          />
          <Textarea
            label="Topicos proibidos"
            {...register('prohibited_topics_text')}
            error={errors.prohibited_topics_text?.message}
            placeholder="Separe por virgula. Ex: testes em animais, concorrente X"
            disabled={!canEdit}
          />

          {canEdit && (
            <div className="flex items-center gap-3 pt-2">
              <Button type="submit" loading={isSaving} disabled={!isDirty && !isNew}>
                {isNew ? 'Criar perfil' : 'Salvar alteracoes'}
              </Button>
              {isDirty && (
                <span className="text-xs text-muted">Alteracoes nao salvas</span>
              )}
            </div>
          )}
        </form>
      </Card>
    </div>
  );
}
