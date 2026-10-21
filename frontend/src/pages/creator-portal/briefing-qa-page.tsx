import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { creatorPortalApi, getCreatorToken } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';

/**
 * Creator-side Q&A (US-31): ask a question, see the answer or an explicit "awaiting answer"
 * state. A question never disappears once asked (scenario 3) -- the thread is re-fetched after
 * asking, not replaced optimistically, so what renders always matches what the backend recorded.
 */
export function CreatorBriefingQaPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const campaignId = searchParams.get('campaign_id') ?? '';
  const queryClient = useQueryClient();
  const [question, setQuestion] = useState('');
  const [askError, setAskError] = useState<string | null>(null);

  useEffect(() => {
    if (!getCreatorToken()) navigate('/creator-portal/access');
  }, [navigate]);

  const { data: thread, isLoading, error } = useQuery({
    queryKey: ['creator-briefing-qa', campaignId],
    queryFn: () => creatorPortalApi.getBriefingQa(campaignId),
    enabled: !!campaignId,
  });

  const askMutation = useMutation({
    mutationFn: () => creatorPortalApi.askBriefingQuestion({ campaign_id: campaignId, question: question.trim() }),
    onSuccess: () => {
      setAskError(null);
      setQuestion('');
      queryClient.invalidateQueries({ queryKey: ['creator-briefing-qa', campaignId] });
    },
    onError: (err) => {
      setAskError(
        isAxiosError(err) && err.response?.data?.error?.message
          ? err.response.data.error.message
          : 'Nao foi possivel enviar sua pergunta agora.',
      );
    },
  });

  if (!campaignId) return <Alert variant="error">Nenhuma campanha informada.</Alert>;
  if (isLoading) return <Spinner />;
  if (error) return <Alert variant="error">Nao foi possivel carregar suas perguntas sobre este briefing.</Alert>;

  const messages = thread?.messages ?? [];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <CardHeader>
        <CardTitle>Perguntas sobre o briefing</CardTitle>
        <CardDescription>Sua conversa aqui e privada -- apenas voce e a marca veem estas mensagens.</CardDescription>
      </CardHeader>

      {messages.length > 0 && (
        <Card>
          <div className="space-y-3">
            {messages.map((m, i) => (
              <div
                key={i}
                className={`rounded-lg p-3 text-sm ${
                  m.sender_type === 'creator' ? 'bg-surface text-text-dark' : 'bg-primary/10 text-text-dark'
                }`}
              >
                <p className="text-xs font-semibold text-muted uppercase mb-1">
                  {m.sender_type === 'creator' ? 'Voce' : 'Marca'}
                </p>
                <p>{m.body}</p>
                <p className="font-mono text-xs text-muted mt-1">{new Date(m.created_at).toLocaleString('pt-BR')}</p>
              </div>
            ))}
          </div>
          {thread?.answered === false && (
            <Badge variant="warning" className="mt-3">
              Aguardando resposta
            </Badge>
          )}
        </Card>
      )}

      <Card>
        <h3 className="text-sm font-semibold text-text-dark mb-3">
          {messages.length > 0 ? 'Fazer outra pergunta' : 'Fazer uma pergunta'}
        </h3>
        {askError && <Alert variant="error" className="mb-3">{askError}</Alert>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            askMutation.mutate();
          }}
          className="space-y-3"
          noValidate
        >
          <Textarea
            label="Sua pergunta"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <Button type="submit" loading={askMutation.isPending} disabled={!question.trim()}>
            Enviar pergunta
          </Button>
        </form>
      </Card>
    </div>
  );
}
