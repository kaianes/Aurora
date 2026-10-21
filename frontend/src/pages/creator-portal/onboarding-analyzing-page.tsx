import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { creatorPortalApi, getCreatorToken } from '@/lib/api-client';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';

/**
 * Onboarding step 4 (US-24.2, US-24.3): a short wait screen while compute-creator-metrics
 * runs server-side -- no input from her here. Polls the same status endpoint step 5 reads,
 * and moves on the moment onboarding_status leaves 'pending'. Per
 * docs/architecture/e8-creator-recruitment-growth.md section 5.7 and section 9 (the job
 * retries with backoff and this screen simply waits for it to resolve).
 */
export function OnboardingAnalyzingPage() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!getCreatorToken()) {
      navigate('/creator-portal/login');
    }
  }, [navigate]);

  const { data } = useQuery({
    queryKey: ['creator-onboarding-status'],
    queryFn: () => creatorPortalApi.getOnboardingStatus(),
    refetchInterval: (query) => (query.state.data?.onboarding_status === 'pending' ? 3000 : false),
  });

  useEffect(() => {
    if (data && data.onboarding_status !== 'pending') {
      navigate('/creator-portal/onboarding/result');
    }
  }, [data, navigate]);

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <CardHeader>
        <CardTitle>Analisando seu perfil</CardTitle>
        <CardDescription>
          Estamos calculando sua audiencia, engajamento e autenticidade a partir das redes que
          voce conectou.
        </CardDescription>
      </CardHeader>
      <Card>
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <Spinner />
          <p className="text-sm text-muted">Isso leva apenas alguns instantes.</p>
        </div>
      </Card>
    </div>
  );
}
