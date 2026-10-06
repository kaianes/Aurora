import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { isAxiosError } from 'axios';
import { creatorPortalApi, setCreatorToken } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

/**
 * Pilot-only creator login (ADR-0013): E8 owns the real creator auth flow
 * (social login or magic link). POST /creator-portal/login exists only so
 * US-28 is testable end-to-end before that flow ships.
 */
export function CreatorAccessPage() {
  const navigate = useNavigate();
  const [creatorId, setCreatorId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!creatorId.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const { access_token } = await creatorPortalApi.login(creatorId.trim());
      setCreatorToken(access_token);
      navigate('/creator-portal/opportunities');
    } catch (err) {
      setError(
        isAxiosError(err) && err.response?.data?.error?.message
          ? err.response.data.error.message
          : 'Nao foi possivel acessar com esse ID.',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-md space-y-6">
      <CardHeader>
        <CardTitle>Acessar suas oportunidades</CardTitle>
        <CardDescription>Entre com o ID de criador recebido junto com sua oportunidade.</CardDescription>
      </CardHeader>
      <Card>
        <Alert variant="info" className="mb-4">
          Acesso piloto: o fluxo definitivo de login de criador (rede social ou link magico) sera entregue em outra
          epic. Por enquanto, entre com seu ID de criador.
        </Alert>
        <form onSubmit={handleSubmit} noValidate className="space-y-3">
          <Input
            label="ID de criador"
            value={creatorId}
            onChange={(e) => setCreatorId(e.target.value)}
            placeholder="Cole seu ID de criador aqui"
          />
          {error && <Alert variant="error">{error}</Alert>}
          <Button type="submit" disabled={!creatorId.trim() || loading} loading={loading}>
            Entrar
          </Button>
        </form>
      </Card>
    </div>
  );
}
