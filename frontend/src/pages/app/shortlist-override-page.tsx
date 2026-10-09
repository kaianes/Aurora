import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { shortlistApi } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';

/**
 * Agency override of the shortlist (US-40). Renata removes system-ranked entries she does
 * not want and adds creators from her own network by creator_id. Saving locks the shortlist
 * (FR-29: never re-ranked after that). Per ADR-0016, falling below the guaranteed minimum is
 * advisory only: the warning below never blocks the save.
 */
export function ShortlistOverridePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [removeIds, setRemoveIds] = useState<Set<string>>(new Set());
  const [newCreatorId, setNewCreatorId] = useState('');
  const [addedCreatorIds, setAddedCreatorIds] = useState<string[]>([]);
  const [eligibilityNotice, setEligibilityNotice] = useState<{ creatorId: string; message: string } | null>(null);

  const { data: shortlist, isLoading, error } = useQuery({
    queryKey: ['shortlist', id],
    queryFn: () => shortlistApi.get(id!),
    enabled: !!id,
  });

  const overrideMutation = useMutation({
    mutationFn: () =>
      shortlistApi.override(id!, {
        remove_entry_ids: Array.from(removeIds),
        add_creators: addedCreatorIds.map((creator_id) => ({ creator_id })),
      }),
    onSuccess: () => navigate(`/app/campaigns/${id}/shortlist`),
    onError: (err) => {
      if (isAxiosError(err) && err.response?.data?.error?.code === 'CREATOR_NOT_ELIGIBLE') {
        const details = err.response.data.error.details;
        setEligibilityNotice({
          creatorId: newCreatorId,
          message:
            err.response.data.error.message ??
            'Este criador ainda nao esta elegivel. Ele precisa concluir o onboarding ou ser convidado.',
        });
        void details;
      }
    },
  });

  const toggleRemove = (entryId: string) => {
    setRemoveIds((prev) => {
      const next = new Set(prev);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
  };

  const addCreator = () => {
    if (!newCreatorId.trim()) return;
    setEligibilityNotice(null);
    setAddedCreatorIds((prev) => [...prev, newCreatorId.trim()]);
    setNewCreatorId('');
  };

  const removeAdded = (creatorId: string) => {
    setAddedCreatorIds((prev) => prev.filter((c) => c !== creatorId));
  };

  const overrideError =
    overrideMutation.error &&
    isAxiosError(overrideMutation.error) &&
    overrideMutation.error.response?.data?.error?.code !== 'CREATOR_NOT_ELIGIBLE'
      ? overrideMutation.error.response?.data?.error?.message ?? 'Nao foi possivel salvar a selecao curada.'
      : null;

  if (isLoading) return <Spinner />;
  if (error || !shortlist) return <Alert variant="error">Nao foi possivel carregar o shortlist para override.</Alert>;

  if (shortlist.locked) {
    return (
      <Alert variant="warning">
        Este shortlist ja esta bloqueado
        {shortlist.locked_reason === 'agency_override' ? ' por um override anterior.' : ' porque a campanha esta ativa.'}
      </Alert>
    );
  }

  const remainingCount = shortlist.entries.filter((e) => e.included && !removeIds.has(e.id)).length + addedCreatorIds.length;
  const belowMinimum =
    shortlist.guaranteed_min_pool_size !== undefined && remainingCount < shortlist.guaranteed_min_pool_size;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <CardHeader>
        <CardTitle>Curadoria da agencia</CardTitle>
        <CardDescription>
          Remova criadores ranqueados pelo sistema e adicione criadores da sua rede. Ao salvar, esta selecao se
          torna definitiva e o sistema nunca mais reordena ou substitui esta lista.
        </CardDescription>
      </CardHeader>

      {/* ADR-0016: advisory only, never blocking the save. */}
      {belowMinimum && (
        <Alert variant="warning">
          Esta selecao ficara abaixo do pool minimo garantido
          {shortlist.guaranteed_min_pool_size !== undefined ? ` (${remainingCount} de ${shortlist.guaranteed_min_pool_size})` : ''}.
          Voce ainda pode salvar; isso sera registrado como um alerta, nao um bloqueio.
        </Alert>
      )}

      {eligibilityNotice && (
        <Alert variant="error">
          Criador {eligibilityNotice.creatorId}: {eligibilityNotice.message}
        </Alert>
      )}
      {overrideError && <Alert variant="error">{overrideError}</Alert>}

      <Card>
        <h3 className="text-sm font-semibold text-text-dark mb-3">Shortlist atual</h3>
        <div className="divide-y divide-border">
          {shortlist.entries.map((entry) => (
            <div key={entry.id} className="flex items-center justify-between py-2">
              <div>
                <p className="text-sm text-text-dark">
                  Criador {entry.creator_id} {entry.rank !== null && <span className="text-muted">· rank #{entry.rank}</span>}
                </p>
                {!entry.included && <Badge variant="default">Ja fora do pool</Badge>}
              </div>
              {entry.included && (
                <Button
                  size="sm"
                  variant={removeIds.has(entry.id) ? 'danger' : 'outline'}
                  onClick={() => toggleRemove(entry.id)}
                >
                  {removeIds.has(entry.id) ? 'Remocao marcada' : 'Remover'}
                </Button>
              )}
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <h3 className="text-sm font-semibold text-text-dark mb-3">Adicionar criadores da sua rede</h3>
        <div className="flex gap-2">
          <Input
            label="ID do criador na Aurora"
            value={newCreatorId}
            onChange={(e) => setNewCreatorId(e.target.value)}
            className="flex-1"
            hint="O criador deve ja possuir um perfil qualificado na Aurora."
          />
          <Button className="self-end" variant="outline" onClick={addCreator} disabled={!newCreatorId.trim()}>
            Adicionar
          </Button>
        </div>
        {addedCreatorIds.length > 0 && (
          <div className="mt-3 space-y-2">
            {addedCreatorIds.map((creatorId) => (
              <div key={creatorId} className="flex items-center justify-between text-sm text-text-dark">
                <span>Criador {creatorId}</span>
                <Button size="sm" variant="ghost" onClick={() => removeAdded(creatorId)}>
                  Remover
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="flex gap-2">
        <Button onClick={() => overrideMutation.mutate()} loading={overrideMutation.isPending}>
          Salvar selecao final
        </Button>
        <Button variant="outline" onClick={() => navigate(`/app/campaigns/${id}/shortlist`)}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
