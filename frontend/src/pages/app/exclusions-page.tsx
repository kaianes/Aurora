import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { isAxiosError } from 'axios';
import { exclusionApi } from '@/lib/api-client';
import { useAuth } from '@/contexts/auth-context';
import { canManageExclusions } from '@/lib/roles';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import type { ExclusionType } from '@/types/api';

interface ExclusionForm {
  exclusion_type: ExclusionType;
  creator_id: string;
  competitor_name: string;
}

/**
 * Exclusion list management (US-14). When rendered under a campaign route, manages
 * campaign-level exclusions (scope: campaign); when rendered at /app/exclusions, manages
 * brand-level exclusions (scope: brand). Both scopes apply with OR semantics per the
 * architecture (section 2.2), so no reconciliation UI is needed between them.
 */
export function ExclusionsPage() {
  const { id: campaignId } = useParams<{ id?: string }>();
  const scope = campaignId ? 'campaign' : 'brand';
  const queryClient = useQueryClient();
  const { currentRole } = useAuth();
  const canManage = currentRole ? canManageExclusions(currentRole) : false;
  const [showForm, setShowForm] = useState(false);

  const queryKey = campaignId ? ['exclusions', campaignId] : ['exclusions', 'brand'];

  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: () => exclusionApi.list(campaignId ? { campaign_id: campaignId } : undefined),
  });

  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors },
  } = useForm<ExclusionForm>({ defaultValues: { exclusion_type: 'creator', creator_id: '', competitor_name: '' } });

  const exclusionType = watch('exclusion_type');

  const createMutation = useMutation({
    mutationFn: (formData: ExclusionForm) =>
      exclusionApi.create({
        scope,
        exclusion_type: formData.exclusion_type,
        creator_id: formData.exclusion_type === 'creator' ? formData.creator_id : undefined,
        competitor_name: formData.exclusion_type === 'competitor_brand' ? formData.competitor_name : undefined,
        campaign_id: campaignId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      reset();
      setShowForm(false);
    },
  });

  const removeMutation = useMutation({
    mutationFn: (exclusionId: string) => exclusionApi.remove(exclusionId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const createError = createMutation.error;
  const createErrorMessage =
    createError && isAxiosError(createError) && createError.response?.data?.error?.message
      ? createError.response.data.error.message
      : createError
        ? 'Nao foi possivel adicionar a exclusao.'
        : null;

  if (isLoading) return <Spinner />;
  if (error) return <Alert variant="error">Nao foi possivel carregar a lista de exclusao.</Alert>;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <CardHeader>
        <CardTitle>{scope === 'brand' ? 'Lista de exclusao da marca' : 'Lista de exclusao da campanha'}</CardTitle>
        <CardDescription>
          Criadores e marcas concorrentes que nunca devem aparecer em um shortlist.
          {scope === 'brand' ? ' Aplica-se a todas as campanhas desta conta.' : ' Aplica-se apenas a esta campanha.'}
        </CardDescription>
      </CardHeader>

      {createMutation.isSuccess && (
        <Alert variant="success">
          Exclusao adicionada. Ela se aplica apenas a proximas geracoes de shortlist; aprovacoes ja feitas nao sao
          afetadas.
        </Alert>
      )}

      {canManage && (
        <Card>
          {!showForm ? (
            <Button size="sm" onClick={() => setShowForm(true)}>
              Adicionar exclusao
            </Button>
          ) : (
            <form
              onSubmit={handleSubmit((formData) => createMutation.mutate(formData))}
              noValidate
              className="space-y-3"
            >
              {createErrorMessage && <Alert variant="error">{createErrorMessage}</Alert>}
              <Select
                label="Tipo"
                options={[
                  { value: 'creator', label: 'Criador especifico' },
                  { value: 'competitor_brand', label: 'Marca concorrente' },
                ]}
                {...register('exclusion_type')}
              />
              {exclusionType === 'creator' ? (
                <Input
                  label="ID do criador"
                  {...register('creator_id', { required: true })}
                  error={errors.creator_id ? 'Informe o ID do criador' : undefined}
                />
              ) : (
                <Input
                  label="Nome da marca concorrente"
                  {...register('competitor_name', { required: true })}
                  error={errors.competitor_name ? 'Informe o nome da marca' : undefined}
                />
              )}
              <div className="flex gap-2">
                <Button type="submit" loading={createMutation.isPending}>
                  Adicionar
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                  Cancelar
                </Button>
              </div>
            </form>
          )}
        </Card>
      )}

      <Card>
        {data && data.data.length > 0 ? (
          <div className="divide-y divide-border">
            {data.data.map((exclusion) => (
              <div key={exclusion.id} className="flex items-center justify-between py-3">
                <div>
                  <p className="text-sm font-medium text-text-dark">
                    {exclusion.exclusion_type === 'creator'
                      ? `Criador ${exclusion.creator_id}`
                      : exclusion.competitor_name}
                  </p>
                  <p className="text-xs text-muted font-mono mt-0.5">
                    <Badge variant="default" className="mr-2">
                      {exclusion.scope === 'brand' ? 'Marca' : 'Campanha'}
                    </Badge>
                    Adicionado em {new Date(exclusion.created_at).toLocaleDateString('pt-BR')}
                  </p>
                </div>
                {canManage && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => removeMutation.mutate(exclusion.id)}
                    loading={removeMutation.isPending}
                  >
                    Remover
                  </Button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted py-8 text-center">Nenhuma exclusao cadastrada.</p>
        )}
      </Card>
    </div>
  );
}
