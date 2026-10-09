import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { templateApi } from '@/lib/api-client';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

export function TemplatesPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['campaign-templates'],
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
              <div key={t.id} className="flex items-center justify-between px-6 py-4">
                <div>
                  <p className="text-sm font-medium text-text-dark">{t.name}</p>
                  <p className="font-mono text-xs text-muted">
                    Criado em {new Date(t.created_at).toLocaleDateString('pt-BR')}
                  </p>
                </div>
                <Link to={`/app/templates/${t.id}/instantiate`}>
                  <Button variant="outline" size="sm">
                    Usar modelo
                  </Button>
                </Link>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
