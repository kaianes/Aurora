import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { auditApi } from '@/lib/api-client';
import { useAuth } from '@/contexts/auth-context';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import type { AuditLogEntry } from '@/types/api';

/** Small colored data point used as a motif accent next to a metric, on a thin grid line. */
function MetricDot({ color }: { color: string }) {
  return <span className="inline-block h-2 w-2 rounded-full mr-2" style={{ backgroundColor: color }} />;
}

function metadataSummary(metadata: Record<string, unknown>): string | null {
  const entries = Object.entries(metadata ?? {});
  if (entries.length === 0) return null;
  return entries.map(([key, value]) => `${key}: ${String(value)}`).join(' · ');
}

/**
 * FR-60 -- the audit log read endpoint's own first (and only) viewer: a chronological,
 * paginated list of actions taken within whichever client account is currently selected via
 * the US-39 client-context selector. There is no cross-client aggregate view (section 5.4 of
 * the E9 architecture doc) -- Renata switches context to see a different client's log, one
 * account at a time, same as every other agency-scoped surface. ip_address/user_agent are
 * never requested here, matching the backend's own data-minimization posture for this screen.
 */
export function AuditLogPage() {
  const { workspace } = useAuth();
  const accountId = workspace?.current_account?.id;
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);

  // Reset the accumulated list whenever the account context changes (the US-39 selector),
  // so no entry from the previous client's log ever lingers in view.
  useEffect(() => {
    setCursor(undefined);
    setEntries([]);
  }, [accountId]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['audit-log', accountId, cursor],
    queryFn: () => auditApi.list({ cursor, limit: 20 }),
    enabled: !!accountId,
  });

  useEffect(() => {
    if (data) {
      setEntries((prev) => (cursor ? [...prev, ...data.data] : data.data));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const errorMessage =
    isAxiosError(error) && error.response?.data?.error?.message
      ? error.response.data.error.message
      : error
        ? 'Nao foi possivel carregar o registro de auditoria agora.'
        : null;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <CardHeader>
        <CardTitle>Registro de auditoria</CardTitle>
        <CardDescription>
          Acoes realizadas na conta de cliente selecionada, em ordem cronologica. Troque de cliente no
          seletor de conta para ver o registro de outra conta.
        </CardDescription>
      </CardHeader>

      {errorMessage && <Alert variant="error">{errorMessage}</Alert>}

      {isLoading && entries.length === 0 && <Spinner />}

      {!isLoading && !error && entries.length === 0 && (
        <Card>
          <p className="text-sm text-muted py-8 text-center">Nenhum evento registrado nesta conta ainda.</p>
        </Card>
      )}

      {entries.length > 0 && (
        <Card className="p-0 overflow-hidden">
          <div className="divide-y divide-border">
            {entries.map((entry) => (
              <div key={entry.id} className="px-6 py-4">
                <div className="flex items-center justify-between gap-4">
                  <p className="flex items-center text-sm font-medium text-text-dark">
                    <MetricDot color="var(--color-strategy-violet)" />
                    {entry.action}
                  </p>
                  <span className="font-mono text-xs text-muted">
                    {new Date(entry.created_at).toLocaleString('pt-BR')}
                  </span>
                </div>
                <p className="text-xs text-muted mt-1">
                  {entry.actor_name ? `${entry.actor_name} (${entry.actor_email})` : 'Sistema'}
                </p>
                {metadataSummary(entry.metadata) && (
                  <p className="font-mono text-xs text-muted mt-1 break-all">{metadataSummary(entry.metadata)}</p>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {data?.pagination.has_more && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            loading={isLoading}
            onClick={() => setCursor(data.pagination.next_cursor ?? undefined)}
          >
            Carregar mais
          </Button>
        </div>
      )}
    </div>
  );
}
