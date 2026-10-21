import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { contentSubmissionApi } from '@/lib/api-client';
import { useAuth } from '@/contexts/auth-context';
import { canDecideContentSubmission } from '@/lib/roles';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import type { BrandContentSubmissionVersion, ReviewDecisionStatus } from '@/types/api';

const STATUS_LABEL: Record<ReviewDecisionStatus, string> = {
  pending: 'Pendente',
  approved: 'Aprovado',
  rejected: 'Rejeitado',
  revision_requested: 'Revisao solicitada',
};

const STATUS_BADGE: Record<ReviewDecisionStatus, 'default' | 'success' | 'warning' | 'error'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'error',
  revision_requested: 'default',
};

function DecideControls({ submissionId }: { submissionId: string }) {
  const queryClient = useQueryClient();
  const { id: campaignId } = useParams<{ id: string }>();
  const [mode, setMode] = useState<'reject' | 'revision' | null>(null);
  const [reason, setReason] = useState('');
  const [decideError, setDecideError] = useState<string | null>(null);

  const decideMutation = useMutation({
    mutationFn: (vars: { decision: 'approved' | 'rejected' | 'revision_requested'; reason?: string }) =>
      contentSubmissionApi.decide(submissionId, vars),
    onSuccess: () => {
      setDecideError(null);
      setMode(null);
      setReason('');
      queryClient.invalidateQueries({ queryKey: ['content-submissions', campaignId] });
    },
    onError: (err) => {
      if (isAxiosError(err) && err.response?.data?.error?.code === 'ALREADY_DECIDED') {
        setDecideError('Esta versao ja foi decidida em outra aba ou por outra pessoa.');
        queryClient.invalidateQueries({ queryKey: ['content-submissions', campaignId] });
        return;
      }
      setDecideError(
        isAxiosError(err) && err.response?.data?.error?.message
          ? err.response.data.error.message
          : 'Nao foi possivel registrar a decisao.',
      );
    },
  });

  return (
    <div className="mt-3 space-y-2">
      {decideError && <Alert variant="error">{decideError}</Alert>}
      {mode === null ? (
        <div className="flex gap-2">
          <Button size="sm" onClick={() => decideMutation.mutate({ decision: 'approved' })} loading={decideMutation.isPending}>
            Aprovar
          </Button>
          <Button size="sm" variant="danger" onClick={() => setMode('reject')}>
            Rejeitar
          </Button>
          <Button size="sm" variant="outline" onClick={() => setMode('revision')}>
            Solicitar revisao
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <Textarea
            label={mode === 'reject' ? 'Motivo da rejeicao (obrigatorio)' : 'O que precisa ser revisado (obrigatorio)'}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={mode === 'reject' ? 'danger' : 'primary'}
              disabled={!reason.trim()}
              loading={decideMutation.isPending}
              onClick={() =>
                decideMutation.mutate({
                  decision: mode === 'reject' ? 'rejected' : 'revision_requested',
                  reason: reason.trim(),
                })
              }
            >
              Confirmar
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setMode(null); setReason(''); }}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function SafetyGateBadge({ cleared, blockingReason }: { cleared: boolean; blockingReason: string | null }) {
  return cleared ? (
    <Badge variant="success">Seguranca: liberado</Badge>
  ) : (
    <Badge variant="warning">Seguranca: {blockingReason ?? 'nao liberado'}</Badge>
  );
}

function SubmissionRow({ item, canDecide }: { item: BrandContentSubmissionVersion; canDecide: boolean }) {
  return (
    <div className="py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text-dark">
            {item.creator_display_name} &middot; versao {item.version_number}
          </p>
          <p className="font-mono text-xs text-muted mt-0.5">
            Enviado em {new Date(item.submitted_at).toLocaleString('pt-BR')}
          </p>
          {item.review_deadline_at && (
            <p className="font-mono text-xs text-muted mt-0.5">
              Prazo de revisao: {new Date(item.review_deadline_at).toLocaleString('pt-BR')}
              {item.review_escalated && <span className="text-error"> &middot; atrasado, escalado</span>}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          <SafetyGateBadge cleared={item.safety_gate.cleared} blockingReason={item.safety_gate.blocking_reason} />
          <Badge variant={STATUS_BADGE[item.review_status]}>{STATUS_LABEL[item.review_status]}</Badge>
        </div>
      </div>

      {item.review_reason && (
        <p className="text-sm text-muted mt-2">
          Motivo registrado para a versao {item.version_number}: {item.review_reason}
        </p>
      )}

      {item.published_url && (
        <p className="text-sm text-text-dark mt-2">
          Publicado:{' '}
          <a href={item.published_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
            {item.published_url}
          </a>
        </p>
      )}

      {item.review_status === 'pending' && canDecide && <DecideControls submissionId={item.id} />}
    </div>
  );
}

/**
 * Marina's review queue (US-19), grouped by lineage. Each group's own `supersedes_submission_id`
 * chain (section 3.3) is used to resolve which versions belong together -- the backend contract
 * does not return a lineage/opportunity identifier on each item, so grouping is derived here from
 * the one relationship it does guarantee. The default view shows only the latest version per
 * lineage; "ver historico" expands the full version chain inline, with each earlier version's own
 * stated reason still visible, unambiguously attributed (US-33 scenario 2).
 */
export function ContentSubmissionsPage() {
  const { id } = useParams<{ id: string }>();
  const { currentRole } = useAuth();
  const canDecide = currentRole ? canDecideContentSubmission(currentRole) : false;
  const [statusFilter, setStatusFilter] = useState<'all' | ReviewDecisionStatus>('all');
  const [expandedRoots, setExpandedRoots] = useState<Set<string>>(new Set());

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['content-submissions', id],
    queryFn: () => contentSubmissionApi.list(id!, { limit: 100 }),
    enabled: !!id,
  });

  const groups = useMemo(() => {
    const items = data?.data ?? [];
    const byId = new Map(items.map((i) => [i.id, i]));
    const rootCache = new Map<string, string>();
    const resolveRoot = (itemId: string): string => {
      if (rootCache.has(itemId)) return rootCache.get(itemId)!;
      const item = byId.get(itemId);
      const root = !item || !item.supersedes_submission_id ? itemId : resolveRoot(item.supersedes_submission_id);
      rootCache.set(itemId, root);
      return root;
    };
    const map = new Map<string, BrandContentSubmissionVersion[]>();
    items.forEach((item) => {
      const root = resolveRoot(item.id);
      if (!map.has(root)) map.set(root, []);
      map.get(root)!.push(item);
    });
    map.forEach((versions) => versions.sort((a, b) => a.version_number - b.version_number));
    return Array.from(map.entries()).map(([root, versions]) => ({
      root,
      versions,
      latest: versions[versions.length - 1],
    }));
  }, [data]);

  const visibleGroups = groups.filter(
    (g) => statusFilter === 'all' || g.latest.review_status === statusFilter,
  );

  const toggleExpanded = (root: string) => {
    setExpandedRoots((prev) => {
      const next = new Set(prev);
      if (next.has(root)) next.delete(root);
      else next.add(root);
      return next;
    });
  };

  if (isLoading) return <Spinner />;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle>Rascunhos de conteudo</CardTitle>
            <CardDescription>
              A versao mais atual de cada envio, com o status de seguranca de marca ao lado da decisao criativa.
            </CardDescription>
          </div>
          <Select
            aria-label="Filtrar por status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | ReviewDecisionStatus)}
            options={[
              { value: 'all', label: 'Todos os status' },
              { value: 'pending', label: 'Pendentes' },
              { value: 'approved', label: 'Aprovados' },
              { value: 'rejected', label: 'Rejeitados' },
              { value: 'revision_requested', label: 'Revisao solicitada' },
            ]}
          />
        </div>
      </CardHeader>

      {error && (
        <Alert variant="error">
          <p>Nao foi possivel carregar os rascunhos agora.</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={() => refetch()}>
            Tentar novamente
          </Button>
        </Alert>
      )}

      {!error && visibleGroups.length === 0 && (
        <Card>
          <p className="text-sm text-muted py-8 text-center">Nenhum rascunho nesse status.</p>
        </Card>
      )}

      {visibleGroups.length > 0 && (
        <div className="space-y-4">
          {visibleGroups.map((group) => (
            <Card key={group.root}>
              <SubmissionRow item={group.latest} canDecide={canDecide} />
              {group.versions.length > 1 && (
                <div className="border-t border-border mt-2 pt-2">
                  <button
                    type="button"
                    onClick={() => toggleExpanded(group.root)}
                    className="text-sm text-primary hover:underline"
                  >
                    {expandedRoots.has(group.root)
                      ? 'Ocultar historico de versoes'
                      : `Ver historico (${group.versions.length} versoes)`}
                  </button>
                  {expandedRoots.has(group.root) && (
                    <div className="divide-y divide-border mt-2">
                      {group.versions
                        .slice(0, -1)
                        .map((v) => <SubmissionRow key={v.id} item={v} canDecide={false} />)}
                    </div>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
