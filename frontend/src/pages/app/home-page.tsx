import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/auth-context';
import { campaignApi } from '@/lib/api-client';
import type { CampaignSummary } from '@/types/api';

const BRAND_ACTIONS = [
  {
    color: '#3DDC97',
    icon: '◈',
    title: 'Criar campanha',
    outcome: 'Monte uma campanha com pool de creators em minutos — preço fixo, alcance garantido.',
    cta: 'Ir para campanhas',
    href: '/app/campaigns',
  },
  {
    color: '#7F77DD',
    icon: '✦',
    title: 'Shortlist com raciocínio de AI',
    outcome: 'Veja quais criadores a Aurora selecionou para você — e por que cada um faz sentido.',
    cta: 'Ver campanhas',
    href: '/app/campaigns',
  },
  {
    color: '#F0507A',
    icon: '⬡',
    title: 'Revisar conteúdo com segurança',
    outcome: 'A AI analisa cada post antes da publicação e te explica o que encontrou.',
    cta: 'Ver fila de revisão',
    href: '/app/safety/review-queue',
  },
  {
    color: '#E8823C',
    icon: '▲',
    title: 'Acompanhar performance',
    outcome: 'Métricas de cada campanha em tempo real — engajamento, alcance, ROI.',
    cta: 'Ver campanhas',
    href: '/app/campaigns',
  },
  {
    color: '#7F77DD',
    icon: '◎',
    title: 'Briefing Q&A com AI',
    outcome: 'Creators tiram dúvidas sobre o brief e a AI responde com base no que você escreveu.',
    cta: 'Ver campanhas',
    href: '/app/campaigns',
  },
  {
    color: '#F0507A',
    icon: '⬡',
    title: 'Templates de campanha',
    outcome: 'Reaproveite campanhas anteriores com um clique — não recomece do zero.',
    cta: 'Ver templates',
    href: '/app/templates',
  },
];

const AGENCY_ACTIONS = [
  {
    color: '#3DDC97',
    icon: '◈',
    title: 'Gerenciar clientes',
    outcome: 'Acesse campanhas de todos os seus clientes em um só lugar, sem trocar de conta.',
    cta: 'Ver clientes',
    href: '/app/clients',
  },
  {
    color: '#7F77DD',
    icon: '✦',
    title: 'Shortlist com raciocínio de AI',
    outcome: 'AI explica em texto por que cada creator foi selecionado para cada campanha.',
    cta: 'Ver clientes',
    href: '/app/clients',
  },
  {
    color: '#F0507A',
    icon: '▲',
    title: 'Relatórios comparativos',
    outcome: 'Compare performance de múltiplos clientes lado a lado em um só relatório.',
    cta: 'Ver relatórios',
    href: '/app/reports/compare',
  },
  {
    color: '#E8823C',
    icon: '◎',
    title: 'Revisão de brand safety',
    outcome: 'AI analisa conteúdo dos creators e sinaliza o que precisa de atenção — para todos os clientes.',
    cta: 'Ver fila de revisão',
    href: '/app/safety/review-queue',
  },
  {
    color: '#7F77DD',
    icon: '⬡',
    title: 'Branding white-label',
    outcome: 'Configure logo e cores da sua agência — clientes veem a sua marca, não a Aurora.',
    cta: 'Configurar branding',
    href: '/app/agency/branding',
  },
  {
    color: '#F0507A',
    icon: '◈',
    title: 'Log de auditoria',
    outcome: 'Rastreie cada ação feita na plataforma — quem fez o quê e quando.',
    cta: 'Ver log',
    href: '/app/audit-log',
  },
];

const CREATOR_ACTIONS = [
  {
    color: '#3DDC97',
    icon: '◈',
    title: 'Ver oportunidades',
    outcome: 'Campanhas que combinam com o seu perfil e público — aceite as que fazem sentido para você.',
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

function getFirstName(fullName: string): string {
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

export function HomePage() {
  const { user, workspace } = useAuth();
  const workspaceType = workspace?.workspace_type ?? 'brand';

  const { data: campaigns } = useQuery({
    queryKey: ['campaigns', 'recent'],
    queryFn: () => campaignApi.list(),
    enabled: workspaceType !== 'agency',
  });

  const firstName = user ? getFirstName(user.name) : '';
  const greeting = getGreeting();
  const actions = workspaceType === 'agency' ? AGENCY_ACTIONS : BRAND_ACTIONS;
  const recentCampaigns = campaigns?.data?.slice(0, 3) ?? [];

  return (
    <>
      <style>{`
        .home-root {
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
          margin-bottom: 2.5rem;
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
          font-size: 12.5px;
          color: var(--color-secondary);
          margin: 0;
          line-height: 1.5;
        }

        .card-cta {
          font-size: 12px;
          font-weight: 500;
          color: var(--color-green);
          margin-top: 4px;
        }

        .recent-section {
          border-top: 1px solid var(--color-border);
          padding-top: 1.75rem;
        }

        .recent-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .recent-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: 8px;
          padding: .75rem 1rem;
          cursor: pointer;
          transition: background .15s;
          width: 100%;
          text-align: left;
        }

        .recent-item:hover { background: var(--color-surface-hover); }

        .recent-name {
          font-size: 14px;
          font-weight: 500;
          color: var(--color-primary);
        }

        .recent-state {
          font-size: 11px;
          font-family: monospace;
          color: var(--color-muted);
          text-transform: uppercase;
          letter-spacing: .05em;
        }

        .recent-arrow {
          color: var(--color-muted);
          font-size: 14px;
        }

        /* tokens */
        :root {
          --color-primary: #0B0E14;
          --color-secondary: #5A6075;
          --color-muted: #9299AE;
          --color-green: #1BB87A;
          --color-surface: #FFFFFF;
          --color-surface-hover: #F4F5F9;
          --color-border: #E4E6EF;
          --color-ground: #F4F5F9;
        }

        @media (prefers-color-scheme: dark) {
          :root:not([data-theme="light"]) {
            --color-primary: #EEF0F8;
            --color-secondary: #8A91A8;
            --color-muted: #5A6075;
            --color-green: #3DDC97;
            --color-surface: #141820;
            --color-surface-hover: #1C2130;
            --color-border: #242A3A;
            --color-ground: #0B0E14;
          }
        }

        :root[data-theme="dark"] {
          --color-primary: #EEF0F8;
          --color-secondary: #8A91A8;
          --color-muted: #5A6075;
          --color-green: #3DDC97;
          --color-surface: #141820;
          --color-surface-hover: #1C2130;
          --color-border: #242A3A;
          --color-ground: #0B0E14;
        }
      `}</style>

      <div className="home-root">
        <div className="home-greeting">
          <p className="greeting-eyebrow">{greeting}</p>
          <h1 className="greeting-name">
            Olá, <span>{firstName}</span>
            <svg className="greeting-sparkle" viewBox="0 0 24 24" fill="url(#sparkle-grad-home)" aria-hidden="true">
              <defs>
                <linearGradient id="sparkle-grad-home" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#A78BFA" />
                  <stop offset="50%" stopColor="#38BDF8" />
                  <stop offset="100%" stopColor="#34D399" />
                </linearGradient>
              </defs>
              <path d="M12 0C12 6.627 17.373 12 24 12C17.373 12 12 17.373 12 24C12 17.373 6.627 12 0 12C6.627 12 12 6.627 12 0Z" />
            </svg>
          </h1>
          <p className="greeting-sub">
            O que vamos fazer hoje? Escolha por onde começar.
          </p>
        </div>

        <p className="section-label">O que a Aurora faz por você</p>
        <div className="action-grid">
          {actions.map((action) => (
            <ActionCard key={action.title} {...action} />
          ))}
        </div>

        {recentCampaigns.length > 0 && (
          <div className="recent-section">
            <p className="section-label">Suas campanhas recentes</p>
            <div className="recent-list">
              {recentCampaigns.map((c) => (
                <RecentCampaignItem key={c.id} campaign={c} />
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function RecentCampaignItem({ campaign }: { campaign: CampaignSummary }) {
  const navigate = useNavigate();
  return (
    <button className="recent-item" onClick={() => navigate(`/app/campaigns/${campaign.id}`)}>
      <div>
        <p className="recent-name">{campaign.name}</p>
        <p className="recent-state">{campaign.state}</p>
      </div>
      <span className="recent-arrow">→</span>
    </button>
  );
}
