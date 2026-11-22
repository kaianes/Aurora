import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { briefingApi } from '@/lib/api-client';
import { useAuth } from '@/contexts/auth-context';
import { canAnswerBriefingQa } from '@/lib/roles';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';

/**
 * Brand-side Q&A (US-31): a thread list -- one row per asking creator, each private to that
 * creator (section 3.2) -- plus a detail panel with every message and an answer composer.
 * `answered` is read straight from the backend, computed at read time there, never cached here.
 */
export function BriefingQaPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { currentRole } = useAuth();
  const canAnswer = currentRole ? canAnswerBriefingQa(currentRole) : false;
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [answerText, setAnswerText] = useState('');
  const [answerError, setAnswerError] = useState<string | null>(null);

  const { data: list, isLoading, error } = useQuery({
    queryKey: ['briefing-qa', id],
    queryFn: () => briefingApi.listQa(id!),
    enabled: !!id,
  });

  const { data: thread, isLoading: isThreadLoading } = useQuery({
    queryKey: ['briefing-qa-thread', id, selectedThreadId],
    queryFn: () => briefingApi.getQaThread(id!, selectedThreadId!),
    enabled: !!id && !!selectedThreadId,
  });

  const answerMutation = useMutation({
    mutationFn: () => briefingApi.answerQa(id!, selectedThreadId!, { body: answerText.trim() }),
    onSuccess: () => {
      setAnswerError(null);
      setAnswerText('');
      queryClient.invalidateQueries({ queryKey: ['briefing-qa-thread', id, selectedThreadId] });
      queryClient.invalidateQueries({ queryKey: ['briefing-qa', id] });
    },
    onError: (err) => {
      setAnswerError(
        isAxiosError(err) && err.response?.data?.error?.message
          ? err.response.data.error.message
          : 'Não foi possível enviar a resposta agora.',
      );
    },
  });

  if (isLoading) return <Spinner />;
  if (error) return <Alert variant="error">Não foi possível carregar as perguntas sobre este briefing.</Alert>;

  const threads = list?.data ?? [];

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex justify-end"><Button variant="ghost" size="sm" onClick={() => navigate(`/app/campaigns/${id}`)}>Voltar para a campanha</Button></div>
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <div className="space-y-4">
        <CardHeader>
          <CardTitle>Perguntas sobre o briefing</CardTitle>
          <CardDescription>Cada thread e privada entre o criador que perguntou e a marca.</CardDescription>
        </CardHeader>

        {threads.length === 0 ? (
          <Card>
            <p className="text-sm text-text-secondary py-6 text-center">Nenhuma pergunta ainda.</p>
          </Card>
        ) : (
          <div className="space-y-2">
            {threads.map((t) => (
              <button
                key={t.thread_id}
                type="button"
                onClick={() => setSelectedThreadId(t.thread_id)}
                className={`w-full text-left rounded-xl border p-4 transition-colors ${
                  selectedThreadId === t.thread_id ? 'border-primary bg-primary/5' : 'border-border-default bg-bg-elevated hover:bg-bg-hover'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-text-primary">{t.creator_display_name}</span>
                  <Badge variant={t.answered ? 'success' : 'warning'}>
                    {t.answered ? 'Respondida' : 'Aguardando resposta'}
                  </Badge>
                </div>
                <p className="font-mono text-xs text-text-secondary mt-1">
                  {t.message_count} mensagem(ns) &middot; {new Date(t.last_message_at).toLocaleString('pt-BR')}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>

      <div>
        <CardHeader>
          <CardTitle>Thread selecionada</CardTitle>
        </CardHeader>
        {!selectedThreadId ? (
          <Card>
            <p className="text-sm text-text-secondary py-6 text-center">Selecione uma pergunta para ver a conversa.</p>
          </Card>
        ) : isThreadLoading ? (
          <Spinner />
        ) : thread ? (
          <Card>
            <div className="space-y-3 mb-4">
              {thread.messages.map((m, i) => (
                <div
                  key={i}
                  className={`rounded-lg p-3 text-sm ${
                    m.sender_type === 'creator' ? 'bg-bg-surface text-text-primary' : 'bg-primary-muted text-text-primary'
                  }`}
                >
                  <p className="text-xs font-semibold text-text-secondary uppercase mb-1">
                    {m.sender_type === 'creator' ? 'Criador' : 'Equipe da marca'}
                  </p>
                  <p>{m.body}</p>
                  <p className="font-mono text-xs text-text-secondary mt-1">{new Date(m.created_at).toLocaleString('pt-BR')}</p>
                </div>
              ))}
            </div>

            {canAnswer && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  answerMutation.mutate();
                }}
                className="space-y-2"
                noValidate
              >
                {answerError && <Alert variant="error">{answerError}</Alert>}
                <Textarea
                  label="Responder"
                  value={answerText}
                  onChange={(e) => setAnswerText(e.target.value)}
                />
                <Button type="submit" size="sm" loading={answerMutation.isPending} disabled={!answerText.trim()}>
                  Enviar resposta
                </Button>
              </form>
            )}
          </Card>
        ) : null}
      </div>
      </div>
    </div>
  );
}
