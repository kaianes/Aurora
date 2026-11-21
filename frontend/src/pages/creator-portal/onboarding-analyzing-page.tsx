import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { creatorPortalApi, getCreatorToken } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

/**
 * US-10.4 (E10): animated onboarding "analyzing" screen.
 *
 * Four steps appear sequentially with a 1.2 s programmatic delay between each.
 * The timing is fully decoupled from actual computation -- the animation plays
 * at a fixed pace regardless of when the backend response arrives (scenario 3).
 *
 * After all four steps complete (~5 s), transitions to a score reveal showing
 * the creator's authenticity score with a circular progress ring and a 3-row
 * signal breakdown (scenario 2).
 *
 * Step labels are defined as constants below -- they are the Brazilian Portuguese
 * canonical forms per docs/architecture/e10-ai-creator-demo.md section 9 and
 * NFR-27. Externalize to an i18n key table when translation support is added.
 *
 * Translation keys (for future i18n):
 *   onboarding.analyzing.step1 = "Verificando autenticidade"
 *   onboarding.analyzing.step2 = "Calculando taxa de engajamento"
 *   onboarding.analyzing.step3 = "Avaliando composicao do publico"
 *   onboarding.analyzing.step4 = "Gerando sua pontuacao"
 */

// ---- step definitions -------------------------------------------------------

const STEPS = [
  {
    label: 'Verificando autenticidade',
    color: 'var(--color-signal-green)',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    ),
  },
  {
    label: 'Calculando taxa de engajamento',
    color: 'var(--color-performance-orange)',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-5 h-5">
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
        <line x1="2" y1="20" x2="22" y2="20" />
      </svg>
    ),
  },
  {
    label: 'Avaliando composicao do publico',
    color: 'var(--color-strategy-violet)',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    label: 'Gerando sua pontuacao',
    color: 'var(--color-creator-pink)',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
        <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
      </svg>
    ),
  },
] as const;

// ---- circular ring ----------------------------------------------------------

const RING_R = 52;
const RING_C = 2 * Math.PI * RING_R; // ≈ 326.73

/**
 * ScoreRing receives the final score directly. The CSS transition on
 * strokeDashoffset handles the visual animation: the first render after
 * the reveal phase sets the offset to 0 (full ring, score=0 from revealedScore
 * initial state), then the subsequent render after the parent's useEffect
 * updates revealedScore to the real value triggers the CSS transition.
 * No internal state or setTimeout needed -- this makes the component
 * easy to test without fake-timer gymnastics.
 */
function ScoreRing({ score }: { score: number }) {
  const offset = RING_C * (1 - score / 100);

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg
        viewBox="0 0 120 120"
        className="w-40 h-40"
        style={{ transform: 'rotate(-90deg)' }}
        aria-hidden="true"
      >
        {/* track */}
        <circle
          cx="60"
          cy="60"
          r={RING_R}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="8"
        />
        {/* progress -- CSS transition animates from initial 0 to actual score */}
        <circle
          cx="60"
          cy="60"
          r={RING_R}
          fill="none"
          stroke="var(--color-signal-green)"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={RING_C}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 1.2s cubic-bezier(0.16,1,0.3,1)' }}
        />
      </svg>
      {/* score number -- counter-rotate so it reads upright */}
      <span
        className="absolute font-mono font-bold text-text-primary"
        style={{ fontSize: '2.5rem', lineHeight: 1 }}
        data-testid="score-value"
      >
        {Math.round(score)}
      </span>
    </div>
  );
}

// ---- signal breakdown bars --------------------------------------------------

interface BreakdownBarProps {
  label: string;
  value: number; // 0-100
  color: string;
}

/**
 * BreakdownBar animates from 0 to value% using a mount flag instead of
 * setTimeout. The mount flag causes a single React re-render that triggers
 * the CSS transition. This works in tests without fake-timer advancement.
 */
function BreakdownBar({ label, value, color }: BreakdownBarProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-text-secondary w-32 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 rounded-full" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}>
        <div
          className="h-1.5 rounded-full"
          style={{
            width: mounted ? `${value}%` : '0%',
            backgroundColor: color,
            transition: 'width 1.2s cubic-bezier(0.16,1,0.3,1)',
          }}
        />
      </div>
      <span className="font-mono text-xs text-text-secondary w-10 text-right">
        {value > 0 ? `${Math.round(value)}%` : '--'}
      </span>
    </div>
  );
}

// ---- step row ---------------------------------------------------------------

type StepStatus = 'pending' | 'active' | 'done';

function StepRow({ step, status }: { step: typeof STEPS[number]; status: StepStatus }) {
  return (
    <div
      className="flex items-center gap-4 py-3 px-4 rounded-lg transition-all duration-500"
      style={{
        opacity: status === 'pending' ? 0.35 : 1,
        backgroundColor: status === 'active' ? 'rgba(255,255,255,0.03)' : 'transparent',
      }}
    >
      {/* icon container */}
      <div
        className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-colors duration-300"
        style={{
          backgroundColor: status === 'pending' ? 'rgba(255,255,255,0.05)' : `${step.color}18`,
          color: status === 'pending' ? 'var(--color-text-muted)' : step.color,
        }}
      >
        {status === 'done' ? (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke={step.color}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-4 h-4"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : status === 'active' ? (
          // mini spinner using CSS animation
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke={step.color}
            strokeWidth="3"
            className="w-4 h-4"
            style={{ animation: 'spin 0.9s linear infinite' }}
          >
            <circle cx="12" cy="12" r="9" strokeOpacity="0.25" />
            <path d="M12 3a9 9 0 0 1 9 9" />
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </svg>
        ) : (
          step.icon
        )}
      </div>

      <span
        className="text-sm font-medium transition-colors duration-300"
        style={{
          color: status === 'done'
            ? 'var(--color-text-primary)'
            : status === 'active'
              ? step.color
              : 'var(--color-text-muted)',
        }}
      >
        {step.label}
      </span>

      {/* thin grid line motif on the right of active step */}
      {status === 'active' && (
        <span className="ml-auto flex gap-1 items-end" aria-hidden="true">
          {[4, 7, 5, 9, 6].map((h, i) => (
            <span
              key={i}
              className="w-0.5 rounded-sm"
              style={{
                height: `${h}px`,
                backgroundColor: step.color,
                opacity: 0.6,
                animation: `barPulse 0.8s ease-in-out ${i * 0.1}s infinite alternate`,
              }}
            />
          ))}
          <style>{`@keyframes barPulse { from { opacity:0.3 } to { opacity:0.8 } }`}</style>
        </span>
      )}
    </div>
  );
}

// ---- main page --------------------------------------------------------------

export function OnboardingAnalyzingPage() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!getCreatorToken()) {
      navigate('/creator-portal/login');
    }
  }, [navigate]);

  // currentStep: 0 = not started, 1-4 = that step is active, 5 = all done
  const [currentStep, setCurrentStep] = useState(0);
  const [phase, setPhase] = useState<'animating' | 'revealed'>('animating');
  // Track score for smooth ring animation after reveal
  const [revealedScore, setRevealedScore] = useState(0);

  const { data } = useQuery({
    queryKey: ['creator-onboarding-status'],
    queryFn: () => creatorPortalApi.getOnboardingStatus(),
    refetchInterval: (query) =>
      query.state.data?.onboarding_status === 'pending' ? 3000 : false,
  });

  // Animation sequence -- fully decoupled from backend latency (US-10.4 scenario 3)
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    // Start the 4-step sequence immediately on mount.
    // Restart cleanly if the user navigates away and back (scenario 5).
    setCurrentStep(1);
    setPhase('animating');
    setRevealedScore(0);

    timersRef.current = [
      setTimeout(() => setCurrentStep(2), 1200),
      setTimeout(() => setCurrentStep(3), 2400),
      setTimeout(() => setCurrentStep(4), 3600),
      setTimeout(() => setCurrentStep(5), 4800),
      setTimeout(() => setPhase('revealed'), 5000),
    ];

    return () => timersRef.current.forEach(clearTimeout);
  }, []); // runs once per mount -- scenario 5 is handled by the fact that every mount restarts

  // Once score reveal phase starts, update revealedScore.
  // No setTimeout delay here: ScoreRing's CSS transition handles the visual
  // animation across the two renders (0 on first reveal render, real score
  // on the second render after this effect fires).
  useEffect(() => {
    if (phase === 'revealed' && data?.authenticity_score != null) {
      setRevealedScore(data.authenticity_score);
    }
  }, [phase, data?.authenticity_score]);

  // ---- breakdown bar values -------------------------------------------------
  // TODO: The API (GET /creator-portal/onboarding/status) does not currently
  // return per-signal breakdown weights. The values below are derived from the
  // available response fields as proxies. The backend should add a
  // signal_breakdown: { engagement_pct, authenticity_pct, audience_pct } object
  // to the endpoint response so the UI can display accurate weights.

  const engagementPct = (() => {
    if (!data?.engagement_rate) return 0;
    const raw = parseFloat(data.engagement_rate.replace('%', ''));
    if (isNaN(raw)) return 0;
    // Normalize: treat 15% engagement as 100% bar (top-tier nano creator)
    return Math.min(100, (raw / 15) * 100);
  })();

  const authenticityPct = data?.authenticity_score ?? 0;

  const audiencePct = (() => {
    if (!data?.audience_size) return 0;
    // Normalize: treat 50k as 100% bar for nano creator context
    return Math.min(100, (data.audience_size / 50000) * 100);
  })();

  // ---- render helpers -------------------------------------------------------

  function stepStatus(stepIndex: number): StepStatus {
    if (currentStep < stepIndex) return 'pending';
    if (currentStep === stepIndex) return 'active';
    return 'done';
  }

  const score = data?.authenticity_score;
  const onboardingStatus = data?.onboarding_status;

  const scoreUnavailable =
    phase === 'revealed' && (score == null || onboardingStatus === 'pending');

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <CardHeader>
        <CardTitle>Analisando seu perfil</CardTitle>
        <CardDescription>
          Calculando sua autenticidade, engajamento e composicao de audiencia.
        </CardDescription>
      </CardHeader>

      {/* Four-step animation card */}
      {phase === 'animating' && (
        <Card className="p-2">
          <div className="space-y-1">
            {STEPS.map((step, i) => (
              <StepRow key={i} step={step} status={stepStatus(i + 1)} />
            ))}
          </div>
        </Card>
      )}

      {/* Score reveal card */}
      {phase === 'revealed' && (
        <Card>
          {scoreUnavailable ? (
            // Scenario 4: analysis still in progress or null score
            <div className="text-center py-8 space-y-3">
              <p className="text-sm font-medium text-text-primary">
                Sua analise esta levando mais tempo que o esperado.
              </p>
              <p className="text-sm text-text-secondary">
                Voce sera notificada quando o resultado estiver pronto.
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-6 py-4">
              {/* Score ring + number */}
              <div className="relative">
                <ScoreRing score={revealedScore} />
              </div>

              <div className="text-center space-y-1">
                <p className="text-sm font-semibold text-text-primary">
                  Pontuacao de autenticidade
                </p>
                {onboardingStatus === 'not_qualified' && (
                  <p className="text-xs text-text-muted italic">
                    Perfil ainda em crescimento
                  </p>
                )}
                {onboardingStatus === 'qualified' && (
                  <p className="text-xs" style={{ color: 'var(--color-signal-green)' }}>
                    Perfil qualificado
                  </p>
                )}
              </div>

              {/* Signal breakdown bars -- motif: colored data points on horizontal grid */}
              <div className="w-full space-y-3 pt-2 border-t border-border-default">
                <BreakdownBar
                  label="Engajamento"
                  value={engagementPct}
                  color="var(--color-performance-orange)"
                />
                <BreakdownBar
                  label="Autenticidade"
                  value={authenticityPct}
                  color="var(--color-signal-green)"
                />
                <BreakdownBar
                  label="Audiencia"
                  value={audiencePct}
                  color="var(--color-strategy-violet)"
                />
              </div>

              <Button
                className="mt-2"
                onClick={() => navigate('/creator-portal/onboarding/result')}
              >
                Ver resultado completo
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
