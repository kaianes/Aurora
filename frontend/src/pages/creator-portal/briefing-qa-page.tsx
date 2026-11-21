import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { creatorPortalApi, getCreatorToken } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import type { QaMessage } from '@/types/api';

/**
 * Creator-side Q&A with AI streaming (US-10.1, E10).
 *
 * Extends the existing E5 Q&A view with:
 * - Chat-style layout: creator messages right, AI/brand messages left
 * - Streaming AI response via fetch() + ReadableStream (not EventSource -- the
 *   endpoint is POST, not GET, per docs/architecture/e10-ai-creator-demo.md section 4.2)
 * - Animated "pensando..." indicator in Signal Green while the stream is in flight
 * - Inline error message on ai_unavailable without crashing the page
 * - Input disabled while a stream is in flight
 */

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001/v1';

/** Animated "pensando..." dots in Signal Green */
function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-1 px-4 py-3">
      <span className="text-xs font-semibold uppercase tracking-wide mr-2" style={{ color: 'var(--color-strategy-violet)' }}>
        Aurora AI
      </span>
      <span className="text-sm text-text-secondary italic">pensando</span>
      <span className="flex gap-0.5 ml-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{
              backgroundColor: 'var(--color-signal-green)',
              animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
            }}
          />
        ))}
      </span>
      <style>{`
        @keyframes pulse {
          0%, 80%, 100% { opacity: 0.2; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}

function AiLabel() {
  return (
    <span
      className="text-xs font-semibold uppercase tracking-wide"
      style={{ color: 'var(--color-strategy-violet)' }}
    >
      Aurora AI
    </span>
  );
}

interface MessageBubbleProps {
  message: QaMessage;
}

function MessageBubble({ message }: MessageBubbleProps) {
  const isCreator = message.sender_type === 'creator';
  const isAi = message.sender_type === 'system';

  return (
    <div className={`flex ${isCreator ? 'justify-end' : 'justify-start'} mb-3`}>
      <div
        className={`max-w-[80%] rounded-xl px-4 py-3 ${
          isCreator
            ? 'rounded-tr-sm bg-bg-surface'
            : isAi
              ? 'rounded-tl-sm'
              : 'rounded-tl-sm bg-bg-surface'
        }`}
        style={
          isAi
            ? {
                backgroundColor: 'rgba(127,119,221,0.1)',
                border: '1px solid rgba(127,119,221,0.2)',
              }
            : undefined
        }
      >
        <p className="text-xs font-semibold text-text-secondary uppercase mb-1">
          {isCreator ? 'Voce' : isAi ? <AiLabel /> : 'Marca'}
        </p>
        <p className="text-sm text-text-primary whitespace-pre-wrap">{message.body}</p>
        <p className="font-mono text-xs text-text-muted mt-1.5">
          {new Date(message.created_at).toLocaleString('pt-BR')}
        </p>
      </div>
    </div>
  );
}

/** Streaming AI bubble -- rendered while tokens are arriving */
function StreamingBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-start mb-3">
      <div
        className="max-w-[80%] rounded-xl rounded-tl-sm px-4 py-3"
        style={{
          backgroundColor: 'rgba(127,119,221,0.1)',
          border: '1px solid rgba(127,119,221,0.2)',
        }}
      >
        <p className="text-xs font-semibold uppercase mb-1">
          <AiLabel />
        </p>
        <p className="text-sm text-text-primary whitespace-pre-wrap">
          {text}
          <span
            className="inline-block w-0.5 h-4 ml-0.5 align-middle"
            style={{
              backgroundColor: 'var(--color-signal-green)',
              animation: 'blink 0.8s step-end infinite',
            }}
          />
          <style>{`@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }`}</style>
        </p>
      </div>
    </div>
  );
}

export function CreatorBriefingQaPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const campaignId = searchParams.get('campaign_id') ?? '';
  const queryClient = useQueryClient();

  const [question, setQuestion] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [thinkingVisible, setThinkingVisible] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!getCreatorToken()) navigate('/creator-portal/login');
  }, [navigate]);

  // Fetch briefing to get briefingId (required by the SSE endpoint path)
  const { data: briefing } = useQuery({
    queryKey: ['creator-briefing', campaignId],
    queryFn: () => creatorPortalApi.getBriefing(campaignId),
    enabled: !!campaignId,
  });

  // Fetch existing Q&A thread
  const { data: thread, isLoading, error } = useQuery({
    queryKey: ['creator-briefing-qa', campaignId],
    queryFn: () => creatorPortalApi.getBriefingQa(campaignId),
    enabled: !!campaignId,
  });

  // Scroll to bottom whenever messages or streaming text change.
  // scrollIntoView is guarded for jsdom compatibility in tests.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView?.({ behavior: 'smooth' });
  }, [thread?.messages, streamingText, thinkingVisible, pendingQuestion]);

  if (!campaignId) return <Alert variant="error">Nenhuma campanha informada.</Alert>;
  if (isLoading) return <Spinner />;
  if (error) return <Alert variant="error">Nao foi possivel carregar suas perguntas sobre este briefing.</Alert>;

  const messages = thread?.messages ?? [];
  const briefingId = briefing?.id ?? null;
  const threadId = thread?.thread_id ?? null;

  const canStream = !!briefingId && !!threadId;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q || isStreaming) return;

    setQuestion('');
    setPendingQuestion(q);
    setIsStreaming(true);
    setThinkingVisible(false);
    setStreamingText('');
    setStreamError(null);

    // If the SSE endpoint is not reachable (no briefingId or threadId), fall back to
    // the existing plain-text endpoint. This covers the case where E10's backend has
    // not yet deployed.
    if (!canStream) {
      // TODO: remove fallback once POST .../messages/ask is deployed (E10 backend)
      try {
        await creatorPortalApi.askBriefingQuestion({ campaign_id: campaignId, question: q });
        queryClient.invalidateQueries({ queryKey: ['creator-briefing-qa', campaignId] });
      } catch {
        setStreamError('Nao foi possivel enviar sua pergunta agora.');
      } finally {
        setPendingQuestion(null);
        setIsStreaming(false);
      }
      return;
    }

    // SSE streaming path
    try {
      const response = await fetch(
        `${API_BASE}/creator-portal/briefings/${briefingId}/qa/${threadId}/messages/ask`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${getCreatorToken()}`,
          },
          body: JSON.stringify({ body: q }),
        },
      );

      if (!response.ok) {
        // HTTP error before the stream opened (403, 404, 422)
        setStreamError('Nao foi possivel enviar sua pergunta agora. Verifique sua conexao com a campanha.');
        setIsStreaming(false);
        setPendingQuestion(null);
        return;
      }

      if (!response.body) {
        throw new Error('response body is null');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let doneSeen = false;

      while (!doneSeen) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        // SSE events are delimited by double newlines
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';

        for (const part of parts) {
          const dataLine = part.split('\n').find((l) => l.startsWith('data: '));
          if (!dataLine) continue;
          let event: { type: string; delta?: string; error?: string } | null = null;
          try {
            event = JSON.parse(dataLine.slice(6));
          } catch {
            continue;
          }
          if (!event) continue;

          if (event.type === 'question_stored') {
            // Question is persisted -- clear the optimistic bubble, the refetch will show it
            setPendingQuestion(null);
            setThinkingVisible(true);
          } else if (event.type === 'ai_thinking') {
            setThinkingVisible(true);
          } else if (event.type === 'token') {
            setThinkingVisible(false);
            setStreamingText((prev) => prev + (event?.delta ?? ''));
          } else if (event.type === 'answer_stored') {
            // Final answer persisted -- refetch will show it
            setStreamingText('');
            setThinkingVisible(false);
            queryClient.invalidateQueries({ queryKey: ['creator-briefing-qa', campaignId] });
          } else if (event.type === 'error' && event.error === 'ai_unavailable') {
            setThinkingVisible(false);
            setStreamingText('');
            setStreamError(
              'Uma resposta automatica nao esta disponivel no momento. Sua pergunta foi salva e pode ser respondida pela equipe da marca.',
            );
          } else if (event.type === 'done') {
            doneSeen = true;
            setIsStreaming(false);
            setThinkingVisible(false);
            if (!streamError) {
              queryClient.invalidateQueries({ queryKey: ['creator-briefing-qa', campaignId] });
            }
          }
        }
      }
    } catch {
      setStreamError('Nao foi possivel responder agora. Tente novamente.');
    } finally {
      setIsStreaming(false);
      setThinkingVisible(false);
      setPendingQuestion(null);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <CardHeader>
        <CardTitle>Perguntas sobre o briefing</CardTitle>
        <CardDescription>
          Sua conversa aqui e privada -- apenas voce e a marca veem estas mensagens. Respostas automaticas sao geradas pela Aurora AI com base no briefing da campanha.
        </CardDescription>
      </CardHeader>

      {/* Chat messages area */}
      <Card className="p-4">
        <div className="min-h-[200px] space-y-1">
          {messages.length === 0 && !pendingQuestion && !isStreaming && (
            <p className="text-sm text-text-muted text-center py-8">
              Nenhuma mensagem ainda. Faca uma pergunta sobre o briefing.
            </p>
          )}

          {messages.map((m, i) => (
            <MessageBubble key={i} message={m} />
          ))}

          {/* Optimistic pending question (while question_stored event hasn't arrived yet) */}
          {pendingQuestion && (
            <MessageBubble
              message={{
                sender_type: 'creator',
                body: pendingQuestion,
                created_at: new Date().toISOString(),
              }}
            />
          )}

          {/* AI thinking indicator */}
          {thinkingVisible && <ThinkingIndicator />}

          {/* Streaming tokens bubble */}
          {streamingText && <StreamingBubble text={streamingText} />}

          <div ref={messagesEndRef} />
        </div>

        {/* Error from SSE stream */}
        {streamError && (
          <Alert variant="error" className="mt-3">
            {streamError}
          </Alert>
        )}

        {/* Unanswered indicator -- kept as Badge to preserve E5 test contract */}
        {!isStreaming && thread?.answered === false && !streamError && messages.length > 0 && (
          <Badge variant="warning" className="mt-3">
            Aguardando resposta
          </Badge>
        )}
      </Card>

      {/* Input area */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold text-text-primary mb-3">
          {messages.length > 0 ? 'Fazer outra pergunta' : 'Fazer uma pergunta'}
        </h3>
        <form onSubmit={handleSubmit} className="space-y-3" noValidate>
          <Textarea
            label="Sua pergunta"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            disabled={isStreaming}
            placeholder="Ex: Posso mencionar que uso o produto no dia a dia?"
          />
          <Button
            type="submit"
            loading={isStreaming}
            disabled={!question.trim() || isStreaming}
          >
            {isStreaming ? 'Aguardando resposta...' : 'Enviar pergunta'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
