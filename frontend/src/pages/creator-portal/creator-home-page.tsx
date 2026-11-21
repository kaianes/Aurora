import { useNavigate } from 'react-router-dom';
import { parseCreatorToken } from '@/lib/api-client';

const CREATOR_ACTIONS = [
  {
    color: '#3DDC97',
    icon: '◈',
    title: 'Suas oportunidades',
    outcome: 'Campanhas que combinam com o seu perfil — aceite as que fazem sentido para você.',
    cta: 'Ver oportunidades',
    href: '/creator-portal/opportunities',
  },
  {
    color: '#7F77DD',
    icon: '✦',
    title: 'Ler o briefing',
    outcome: 'Entenda exatamente o que a marca espera — formato, tom, hashtags obrigatórias.',
    cta: 'Ver briefing',
    href: '/creator-portal/briefing',
  },
  {
    color: '#F0507A',
    icon: '◎',
    title: 'Tirar dúvidas com AI',
    outcome: 'Pergunte qualquer coisa sobre o brief — a AI responde na hora com base no que a marca escreveu.',
    cta: 'Ir para Q&A',
    href: '/creator-portal/briefing/qa',
  },
  {
    color: '#E8823C',
    icon: '▲',
    title: 'Enviar conteúdo',
    outcome: 'Submeta seu rascunho para aprovação — a Aurora checa brand safety antes de te responder.',
    cta: 'Enviar rascunho',
    href: '/creator-portal/drafts/new',
  },
  {
    color: '#7F77DD',
    icon: '⬡',
    title: 'Meus pagamentos',
    outcome: 'Veja quanto você vai receber, quando, e o breakdown de cada campanha — sem surpresas.',
    cta: 'Ver pagamentos',
    href: '/creator-portal/payments',
  },
  {
    color: '#F0507A',
    icon: '◈',
    title: 'Meu media kit',
    outcome: 'Perfil gerado automaticamente com suas métricas reais — pronto para compartilhar.',
    cta: 'Ver media kit',
    href: '/creator-portal/media-kit',
  },
];

function getFirstName(fullName?: string): string {
  if (!fullName) return '';
  return fullName.split(' ')[0];
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Bom dia';
  if (hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

interface ActionCardProps {
  color: string;
  icon: string;
  title: string;
  outcome: string;
  cta: string;
  href: string;
}

function ActionCard({ color, icon, title, outcome, cta, href }: ActionCardProps) {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => navigate(href)}
      className="action-card"
      style={{ '--card-accent': color } as React.CSSProperties}
    >
      <span className="card-icon" style={{ color }}>{icon}</span>
      <div className="card-body">
        <p className="card-title">{title}</p>
        <p className="card-outcome">{outcome}</p>
        <span className="card-cta">{cta} →</span>
      </div>
    </button>
  );
}

export function CreatorHomePage() {
  const { name, display_name } = parseCreatorToken();
  const firstName = getFirstName(name) || display_name || 'Creator';
  const greeting = getGreeting();

  return (
    <>
      <style>{`
        .creator-home-root {
          max-width: 860px;
          margin: 0 auto;
          padding: 2.5rem 0 4rem;
        }

        .home-greeting {
          margin-bottom: 2.75rem;
        }

        .greeting-eyebrow {
          font-size: 13px;
          font-weight: 500;
          letter-spacing: .08em;
          text-transform: uppercase;
          color: var(--color-secondary);
          margin: 0 0 .4rem;
        }

        .greeting-name {
          font-size: clamp(2rem, 5vw, 3rem);
          font-weight: 700;
          line-height: 1.1;
          color: var(--color-primary);
          margin: 0 0 .6rem;
          text-wrap: balance;
        }

        .greeting-name span {
          background: linear-gradient(90deg, #A78BFA, #38BDF8, #34D399);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .greeting-sparkle {
          display: inline-block;
          width: 0.75em;
          height: 0.75em;
          vertical-align: middle;
          margin-left: 0.15em;
          margin-bottom: 0.1em;
          flex-shrink: 0;
        }

        .greeting-sub {
          font-size: 15px;
          color: var(--color-secondary);
          margin: 0;
          line-height: 1.6;
        }

        .section-label {
          font-size: 11px;
          font-weight: 600;
          letter-spacing: .1em;
          text-transform: uppercase;
          color: var(--color-muted);
          margin: 0 0 1rem;
        }

        .action-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }

        @media (max-width: 600px) {
          .action-grid { grid-template-columns: 1fr; }
        }

        .action-card {
          display: flex;
          align-items: flex-start;
          gap: 14px;
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-left: 3px solid var(--card-accent, #3DDC97);
          border-radius: 10px;
          padding: 1.1rem 1.25rem;
          text-align: left;
          cursor: pointer;
          transition: border-color .15s, background .15s, transform .1s;
          width: 100%;
        }

        .action-card:hover {
          background: var(--color-surface-hover);
          transform: translateY(-1px);
        }

        .action-card:active { transform: translateY(0); }

        .card-icon {
          font-size: 20px;
          flex-shrink: 0;
          margin-top: 1px;
          line-height: 1;
        }

        .card-body {
          display: flex;
          flex-direction: column;
          gap: 4px;
          min-width: 0;
        }

        .card-title {
          font-size: 14px;
          font-weight: 600;
          color: var(--color-primary);
          margin: 0;
        }

        .card-outcome {
          font-size: 12px;
          color: var(--color-secondary);
          margin: 0;
          line-height: 1.5;
        }

        .card-cta {
          font-size: 12px;
          font-weight: 500;
          color: var(--color-muted);
          margin-top: 2px;
        }
      `}</style>

      <div className="creator-home-root">
        <div className="home-greeting">
          <p className="greeting-eyebrow">{greeting}</p>
          <h1 className="greeting-name">
            <span>{firstName}</span>
            <svg
              className="greeting-sparkle"
              viewBox="0 0 24 24"
              fill="url(#sparkle-grad-creator-home)"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <defs>
                <linearGradient id="sparkle-grad-creator-home" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#A78BFA" />
                  <stop offset="50%" stopColor="#38BDF8" />
                  <stop offset="100%" stopColor="#34D399" />
                </linearGradient>
              </defs>
              <path d="M12 0C12 6.627 17.373 12 24 12C17.373 12 12 17.373 12 24C12 17.373 6.627 12 0 12C6.627 12 12 6.627 12 0Z" />
            </svg>
          </h1>
          <p className="greeting-sub">O que você quer fazer hoje?</p>
        </div>

        <p className="section-label">Ações rápidas</p>
        <div className="action-grid">
          {CREATOR_ACTIONS.map((action) => (
            <ActionCard key={action.title} {...action} />
          ))}
        </div>
      </div>
    </>
  );
}
