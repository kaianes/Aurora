import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { agencyApi, templateApi } from '@/lib/api-client';
import { useAuth } from '@/contexts/auth-context';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';

/**
 * Renata's cross-client template copy (US-41): selecting a target client account and copying
 * a template's structure into it, via POST /campaign-templates/:id/copy. Per
 * docs/architecture/e9-agency-multi-client-operations.md section 4.2, the caller's own
 * X-Account-Id already resolves to the source account -- no account switching is needed here,
 * unlike client-report-page's pattern.
 */
function CopyTemplateAction({ templateId }: { templateId: string }) {
  const queryClient = useQueryClient();
  const { workspace } = useAuth();
  const [open, setOpen] = useState(false);
  const [targetAccountId, setTargetAccountId] = useState('');
  const [success, setSuccess] = useState(false);

  const currentAccountId = workspace?.current_account?.id;

  const { data: clients } = useQuery({
    queryKey: ['agency-clients'],
    queryFn: () => agencyApi.listClients(),
    enabled: open,
  });

  // Every other client in the workspace, excluding the source account itself (ADR-0060's
  // INVALID_TARGET rule: the target must differ from the source).
  const targetOptions = (clients?.data ?? [])
    .filter((c) => c.id !== currentAccountId)
    .map((c) => ({ value: c.id, label: c.name }));

  const copyMutation = useMutation({
    mutationFn: () => templateApi.copy(templateId, { target_account_id: targetAccountId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaign-templates'] });
      setSuccess(true);
      setOpen(false);
      setTargetAccountId('');
      setTimeout(() => setSuccess(false), 3000);
    },
  });

  const errorMessage =
    copyMutation.error && isAxiosError(copyMutation.error) && copyMutation.error.response?.data?.error?.message
      ? copyMutation.error.response.data.error.message
      : copyMutation.error
        ? 'Nao foi possivel copiar o modelo para esse cliente.'
        : null;

  return (
    <div>
      {success && (
        <p className="text-xs text-success mb-2" role="status">
          Modelo copiado com sucesso.
        </p>
      )}
      {!open ? (
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          Copiar para outro cliente
        </Button>
      ) : (
        <div className="space-y-2 rounded-lg border border-border p-3 bg-surface">
          {errorMessage && <Alert variant="error">{errorMessage}</Alert>}
          <Select
            label="Cliente de destino"
            placeholder="Selecione um cliente"
            options={targetOptions}
            value={targetAccountId}
            onChange={(e) => setTargetAccountId(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => copyMutation.mutate()}
              loading={copyMutation.isPending}
              disabled={!targetAccountId}
            >
              Confirmar copia
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setOpen(false);
                setTargetAccountId('');
              }}
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function TemplatesPage() {
  const { workspace } = useAuth();
  const isAgency = workspace?.workspace?.type === 'agency';
  const accountId = workspace?.current_account?.id;

  // Keyed on accountId (the US-39 client-context selector) so switching client context refetches
  // instead of continuing to show the previous client's templates.
  const { data, isLoading, error } = useQuery({
    queryKey: ['campaign-templates', accountId],
    queryFn: () => templateApi.list({ limit: 50 }),
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <CardHeader>
        <CardTitle>Biblioteca de modelos</CardTitle>
        <CardDescription>
          Reutilize a estrutura de campanhas confirmadas para montar novas campanhas em minutos.
        </CardDescription>
      </CardHeader>

      {isLoading && <Spinner />}
      {error && <Alert variant="error">Nao foi possivel carregar os modelos.</Alert>}

      {data && data.data.length === 0 && (
        <Card>
          <p className="text-sm text-muted text-center py-6">
            Nenhum modelo salvo ainda. Confirme uma campanha e salve-a como modelo para comecar.
          </p>
        </Card>
      )}

      {data && data.data.length > 0 && (
        <Card className="p-0 overflow-hidden">
          <div className="divide-y divide-border">
            {data.data.map((t) => (
              <div key={t.id} className="flex items-center justify-between px-6 py-4 gap-4">
                <div>
                  <p className="text-sm font-medium text-text-dark">{t.name}</p>
                  <p className="font-mono text-xs text-muted">
                    Criado em {new Date(t.created_at).toLocaleDateString('pt-BR')}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {isAgency && <CopyTemplateAction templateId={t.id} />}
                  <Link to={`/app/templates/${t.id}/instantiate`}>
                    <Button variant="outline" size="sm">
                      Usar modelo
                    </Button>
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
