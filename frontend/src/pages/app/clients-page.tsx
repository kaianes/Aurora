import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { agencyApi } from '@/lib/api-client';
import { useAuth } from '@/contexts/auth-context';
import { canManageClients } from '@/lib/roles';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';

const createClientSchema = z.object({
  name: z.string().min(2, 'Nome deve ter pelo menos 2 caracteres').max(100),
  copy_templates_from: z.string().optional(),
});

type CreateClientForm = z.infer<typeof createClientSchema>;

export function ClientsPage() {
  const { currentRole } = useAuth();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [createSuccess, setCreateSuccess] = useState(false);

  const isAdmin = currentRole ? canManageClients(currentRole) : false;

  const { data, isLoading, error: fetchError } = useQuery({
    queryKey: ['agency-clients'],
    queryFn: () => agencyApi.listClients(),
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateClientForm>({
    resolver: zodResolver(createClientSchema),
  });

  const createMutation = useMutation({
    mutationFn: agencyApi.createClient,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agency-clients'] });
      reset();
      setShowForm(false);
      setCreateSuccess(true);
      setTimeout(() => setCreateSuccess(false), 3000);
    },
  });

  const createError = createMutation.error;
  const createErrorMessage =
    createError && isAxiosError(createError) && createError.response?.data?.error?.message
      ? createError.response.data.error.message
      : createError
        ? 'Nao foi possivel criar a conta do cliente.'
        : null;

  const isAtLimit = data ? data.limits.used >= data.limits.max : false;

  if (isLoading) {
    return <Spinner />;
  }

  if (fetchError) {
    return (
      <Alert variant="error">
        {isAxiosError(fetchError) && fetchError.response?.data?.error?.message
          ? fetchError.response.data.error.message
          : 'Nao foi possivel carregar as contas de clientes.'}
      </Alert>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Clientes</CardTitle>
            <CardDescription>Gerencie as contas de clientes da agencia.</CardDescription>
          </div>
          {data && (
            <Badge variant={isAtLimit ? 'error' : 'primary'} className="font-mono">
              {data.limits.used} / {data.limits.max}
            </Badge>
          )}
        </div>
      </CardHeader>

      {createSuccess && (
        <Alert variant="success">Conta de cliente criada com sucesso.</Alert>
      )}

      {/* Create client form */}
      {isAdmin && (
        <Card>
          {!showForm ? (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted">
                {isAtLimit
                  ? 'Limite de contas de clientes atingido. Entre em contato com o suporte para aumentar.'
                  : 'Adicione uma nova conta de cliente a agencia.'}
              </p>
              <Button
                onClick={() => setShowForm(true)}
                disabled={isAtLimit}
                size="sm"
              >
                Novo cliente
              </Button>
            </div>
          ) : (
            <>
              <h3 className="text-sm font-semibold text-text-dark mb-3">Novo cliente</h3>
              {createErrorMessage && (
                <Alert variant="error" className="mb-3">{createErrorMessage}</Alert>
              )}
              <form
                onSubmit={handleSubmit((formData) =>
                  createMutation.mutate({
                    name: formData.name,
                    copy_templates_from: formData.copy_templates_from || undefined,
                  }),
                )}
                noValidate
                className="space-y-3"
              >
                <Input
                  label="Nome do cliente"
                  {...register('name')}
                  error={errors.name?.message}
                />
                {data && data.data.length > 0 && (
                  <div className="space-y-1">
                    <label htmlFor="copy-templates" className="block text-sm font-medium text-text-dark">
                      Copiar templates de (opcional)
                    </label>
                    <select
                      id="copy-templates"
                      {...register('copy_templates_from')}
                      className="block w-full rounded-lg border border-border px-3 py-2 text-sm"
                    >
                      <option value="">Nenhum</option>
                      {data.data.map((client) => (
                        <option key={client.id} value={client.id}>{client.name}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="flex gap-2">
                  <Button type="submit" loading={createMutation.isPending}>
                    Criar conta
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowForm(false);
                      reset();
                    }}
                  >
                    Cancelar
                  </Button>
                </div>
              </form>
            </>
          )}
        </Card>
      )}

      {/* Client list */}
      <Card>
        {data && data.data.length > 0 ? (
          <div className="divide-y divide-border">
            {data.data.map((client) => (
              <Link
                key={client.id}
                to={`/app/clients/${client.id}`}
                className="flex items-center justify-between py-3 hover:bg-surface -mx-6 px-6 transition-colors"
              >
                <div>
                  <p className="text-sm font-medium text-text-dark">{client.name}</p>
                  <p className="text-xs text-muted font-mono">
                    Criado em {new Date(client.created_at).toLocaleDateString('pt-BR')}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {client.brand_profile_status && (
                    <Badge variant={client.brand_profile_status === 'complete' ? 'success' : 'warning'}>
                      Perfil: {client.brand_profile_status === 'complete' ? 'Completo' : 'Rascunho'}
                    </Badge>
                  )}
                  <Badge variant={client.status === 'active' ? 'success' : 'error'}>
                    {client.status === 'active' ? 'Ativo' : 'Suspenso'}
                  </Badge>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted py-8 text-center">
            Nenhuma conta de cliente. Crie a primeira para comecar.
          </p>
        )}
      </Card>
    </div>
  );
}
