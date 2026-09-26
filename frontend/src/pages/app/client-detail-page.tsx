import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { agencyApi, brandProfileApi, memberApi, setCurrentAccountId } from '@/lib/api-client';
import { useAuth } from '@/contexts/auth-context';
import { canManageClients } from '@/lib/roles';
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

export function ClientDetailPage() {
  const { id: clientId } = useParams<{ id: string }>();
  const { currentRole, workspace } = useAuth();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const isAdmin = currentRole ? canManageClients(currentRole) : false;

  // Temporarily switch account context to the client account for brand profile operations
  const originalAccountId = workspace?.current_account?.id;

  // Fetch brand profile for this client account
  const { data: profile, isLoading: loadingProfile, error: profileError } = useQuery({
    queryKey: ['brand-profile', clientId],
    queryFn: () => {
      if (clientId) setCurrentAccountId(clientId);
      return brandProfileApi.getCurrent();
    },
    enabled: !!clientId,
  });

  const isNewProfile = isAxiosError(profileError) && profileError.response?.status === 404;

  // Fetch members for operator management
  const { data: membersData } = useQuery({
    queryKey: ['members', clientId],
    queryFn: () => {
      if (originalAccountId) setCurrentAccountId(originalAccountId);
      // Members of the workspace, to pick operators from
      return memberApi.list(originalAccountId ?? '');
    },
    enabled: !!originalAccountId && isAdmin,
  });

  // Reset account context after queries
  useEffect(() => {
    return () => {
      if (originalAccountId) setCurrentAccountId(originalAccountId);
    };
  }, [originalAccountId]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
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
    mutationFn: (data: Parameters<typeof brandProfileApi.create>[0]) => {
      if (clientId) setCurrentAccountId(clientId);
      return brandProfileApi.create(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['brand-profile', clientId] });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    },
    onSettled: () => {
      if (originalAccountId) setCurrentAccountId(originalAccountId);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof brandProfileApi.update>[1] }) => {
      if (clientId) setCurrentAccountId(clientId);
      return brandProfileApi.update(id, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['brand-profile', clientId] });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    },
    onSettled: () => {
      if (originalAccountId) setCurrentAccountId(originalAccountId);
    },
  });

  const logoMutation = useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) => {
      if (clientId) setCurrentAccountId(clientId);
      return brandProfileApi.uploadLogo(id, file);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['brand-profile', clientId] });
    },
    onSettled: () => {
      if (originalAccountId) setCurrentAccountId(originalAccountId);
    },
  });

  const addOperatorMutation = useMutation({
    mutationFn: (userId: string) => agencyApi.addOperator(clientId!, { user_id: userId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['members', clientId] });
    },
  });

  const removeOperatorMutation = useMutation({
    mutationFn: (userId: string) => agencyApi.removeOperator(clientId!, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['members', clientId] });
    },
  });

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

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const saveError = createMutation.error ?? updateMutation.error;
  const saveErrorMessage =
    saveError && isAxiosError(saveError) && saveError.response?.data?.error?.message
      ? saveError.response.data.error.message
      : saveError
        ? 'Nao foi possivel salvar o perfil.'
        : null;

  // Filter operators from members list
  const operators = membersData?.data.filter((m) => m.role === 'agency_operator') ?? [];

  if (loadingProfile && !isNewProfile) {
    return <Spinner />;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Detalhes do Cliente</CardTitle>
            <CardDescription>Perfil da marca e gerenciamento de operadores.</CardDescription>
          </div>
          {profile && (
            <Badge variant={profile.status === 'complete' ? 'success' : 'warning'}>
              {profile.status === 'complete' ? 'Completo' : 'Rascunho'}
            </Badge>
          )}
        </div>
      </CardHeader>

      {saveSuccess && <Alert variant="success">Perfil salvo com sucesso.</Alert>}
      {saveErrorMessage && <Alert variant="error">{saveErrorMessage}</Alert>}

      {/* Brand profile form */}
      <Card>
        <h3 className="text-sm font-semibold text-text-dark mb-3">Perfil da Marca</h3>

        {profile && (
          <div className="mb-4">
            <div className="flex items-center gap-4">
              {profile.logo_url ? (
                <img
                  src={profile.logo_url}
                  alt="Logo do cliente"
                  className="h-16 w-16 rounded-lg object-cover border border-border"
                />
              ) : (
                <div className="h-16 w-16 rounded-lg bg-surface border border-border flex items-center justify-center text-muted text-xs">
                  Sem logo
                </div>
              )}
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".png,.jpg,.jpeg,.svg,.webp"
                  onChange={handleLogoUpload}
                  className="hidden"
                  aria-label="Enviar logo do cliente"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  loading={logoMutation.isPending}
                >
                  {profile.logo_url ? 'Alterar logo' : 'Enviar logo'}
                </Button>
              </div>
            </div>
            {logoMutation.error && (
              <p className="mt-2 text-sm text-error" role="alert">
                Nao foi possivel enviar o logo. Verifique o formato e tamanho.
              </p>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          <Input label="Nome da marca" {...register('name')} error={errors.name?.message} />
          <Textarea
            label="Tom de voz"
            {...register('tone_of_voice')}
            placeholder="Ex: Informal, divertido, inclusivo"
          />
          <Textarea
            label="Diretrizes de conteudo"
            {...register('content_guidelines')}
            placeholder="Instrucoes para criacao de conteudo..."
          />
          <Textarea
            label="Topicos proibidos"
            {...register('prohibited_topics_text')}
            placeholder="Separe por virgula"
          />
          <div className="flex items-center gap-3 pt-2">
            <Button type="submit" loading={isSaving} disabled={!isDirty && !isNewProfile}>
              {isNewProfile ? 'Criar perfil' : 'Salvar alteracoes'}
            </Button>
          </div>
        </form>
      </Card>

      {/* Operator management */}
      {isAdmin && (
        <Card>
          <h3 className="text-sm font-semibold text-text-dark mb-3">Operadores</h3>
          <p className="text-xs text-muted mb-3">
            Atribua operadores a este cliente para que possam gerenciar campanhas.
          </p>

          {operators.length > 0 ? (
            <div className="divide-y divide-border mb-4">
              {operators.map((op) => (
                <div key={op.user_id} className="flex items-center justify-between py-2">
                  <div>
                    <p className="text-sm text-text-dark">{op.name}</p>
                    <p className="text-xs text-muted">{op.email}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => addOperatorMutation.mutate(op.user_id)}
                      loading={addOperatorMutation.isPending}
                    >
                      Atribuir
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-error"
                      onClick={() => removeOperatorMutation.mutate(op.user_id)}
                      loading={removeOperatorMutation.isPending}
                    >
                      Revogar
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted py-4 text-center">
              Nenhum operador no workspace. Convide operadores pela pagina de Equipe.
            </p>
          )}

          {addOperatorMutation.error && (
            <Alert variant="error">
              {isAxiosError(addOperatorMutation.error) && addOperatorMutation.error.response?.data?.error?.message
                ? addOperatorMutation.error.response.data.error.message
                : 'Nao foi possivel atribuir o operador.'}
            </Alert>
          )}
        </Card>
      )}
    </div>
  );
}
