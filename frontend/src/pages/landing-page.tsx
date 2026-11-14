import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';

function useScrollReveal() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('animate-fade-up');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: '0px 0px -40px 0px' },
    );
    el.querySelectorAll('[data-reveal]').forEach((child) => {
      (child as HTMLElement).style.opacity = '0';
      observer.observe(child);
    });
    return () => observer.disconnect();
  }, []);
  return ref;
}

const features = [
  {
    icon: 'M13 10V3L4 14h7v7l9-11h-7z',
    title: 'Pool Buying',
    description: 'Compre um pool de criadores como uma unidade de mídia. Preço fechado, alcance garantido, sem negociação individual.',
    color: '#A78BFA',
  },
  {
    icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
    title: 'Brand Safety',
    description: 'Verificação de conteúdo antes da publicação, não depois. Regras por marca, fila de revisão humana, monitoramento pós-publicação.',
    color: '#38BDF8',
  },
  {
    icon: 'M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z',
    title: 'Pagamento Justo',
    description: 'Criadores veem exatamente quanto vão receber antes de aceitar. Pagamento rápido, comissão transparente, sem surpresas.',
    color: '#34D399',
  },
  {
    icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
    title: 'Analytics & ROI',
    description: 'Dashboard consolidado por campanha. Exportação de relatórios, métricas por criador, comparação entre clientes para agências.',
    color: '#F0ABFC',
  },
  {
    icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z',
    title: 'Recrutamento Ativo',
    description: 'Não espere criadores se cadastrarem. Encontre e convide quem realmente engaja — a única vantagem durável neste mercado.',
    color: '#FBBF24',
  },
  {
    icon: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4',
    title: 'Multi-Client (Agências)',
    description: 'Troque de cliente em um clique. Templates compartilhados, white-label, auditoria, relatórios públicos tokenizados.',
    color: '#38BDF8',
  },
];

const personas = [
  {
    role: 'Para Marcas',
    pain: 'Plataformas enterprise custam mais que seu orçamento. Planilhas não escalam.',
    solution: 'Campanha criada em minutos, pool curado automaticamente, investimento sob controle.',
    gradient: 'from-violet-500/20 to-cyan-500/20',
  },
  {
    role: 'Para Creators',
    pain: 'Pagamento em 60+ dias, sem saber quanto vai receber, briefs vagos, retrabalho não pago.',
    solution: 'Pagamento rápido e transparente, brief estruturado, fluxo de aprovação claro.',
    gradient: 'from-pink-500/20 to-violet-500/20',
  },
  {
    role: 'Para Agências',
    pain: 'Curadoria manual que não escala, relatórios refeitos por cliente, margem comida por operação.',
    solution: 'Shortlist assistida, templates entre clientes, white-label, auditoria centralizada.',
    gradient: 'from-cyan-500/20 to-emerald-500/20',
  },
];

export function LandingPage() {
  const revealRef = useScrollReveal();

  return (
    <div ref={revealRef}>
      {/* ── HERO ── */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 aurora-glow-strong" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] rounded-full bg-violet-500/8 blur-[100px] animate-pulse-glow" />
        <div className="absolute top-20 left-1/4 w-[300px] h-[300px] rounded-full bg-cyan-500/5 blur-[80px] animate-pulse-glow" style={{ animationDelay: '2s' }} />

        <div className="relative mx-auto max-w-4xl px-4 pt-24 pb-20 sm:pt-32 sm:pb-28 text-center">
          <div data-reveal className="inline-flex items-center gap-2 rounded-full border border-border-accent bg-primary-muted px-4 py-1.5 text-sm font-medium text-violet-400 mb-8">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-violet-400" />
            </span>
            Influência com tecnologia e inteligência de dados
          </div>

          <h1 data-reveal className="text-4xl sm:text-5xl md:text-6xl font-black tracking-tight leading-[1.1] mb-6 delay-100">
            Creator economy
            <br />
            <span className="text-gradient">com lógica de mídia.</span>
          </h1>

          <p data-reveal className="text-lg sm:text-xl text-text-secondary max-w-2xl mx-auto mb-10 leading-relaxed delay-200">
            A Aurora conecta marcas, agências e criadores em uma única plataforma.
            Campanhas com brand safety integrado e pagamento justo — do briefing ao resultado.
          </p>

          <div data-reveal className="delay-300">
            <Link
              to="/register"
              className="group relative inline-flex items-center gap-2 rounded-xl bg-violet-500 px-8 py-3.5 text-base font-bold text-white transition-all duration-300 hover:bg-violet-600 shadow-[0_0_30px_rgba(139,92,246,0.3)] hover:shadow-[0_0_40px_rgba(139,92,246,0.5)] hover:-translate-y-0.5"
            >
              Criar conta grátis
              <svg className="h-4 w-4 transition-transform group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </Link>
          </div>
        </div>
      </section>

      {/* ── SOCIAL PROOF BAR ── */}
      <section className="relative border-y border-border-default bg-aurora-950/50">
        <div className="mx-auto max-w-5xl px-4 py-12">
          <div data-reveal className="grid grid-cols-1 sm:grid-cols-3 gap-8 text-center">
            <div>
              <div className="text-3xl sm:text-4xl font-black font-mono text-gradient">100%</div>
              <div className="mt-1 text-sm text-text-muted">Brand safety pré-publicação</div>
            </div>
            <div>
              <div className="text-3xl sm:text-4xl font-black font-mono text-gradient">Preço fechado</div>
              <div className="mt-1 text-sm text-text-muted">Sem surpresas no investimento</div>
            </div>
            <div>
              <div className="text-3xl sm:text-4xl font-black font-mono text-gradient">Pool curado</div>
              <div className="mt-1 text-sm text-text-muted">Nano e micro criadores selecionados</div>
            </div>
          </div>
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section className="relative py-20 sm:py-28">
        <div className="absolute inset-0 aurora-glow opacity-50" />
        <div className="relative mx-auto max-w-6xl px-4">
          <div data-reveal className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-black tracking-tight mb-4">
              Uma plataforma,{' '}
              <span className="text-gradient">todo o ciclo</span>
            </h2>
            <p className="text-lg text-text-secondary max-w-2xl mx-auto">
              Do planejamento ao pagamento: módulos integrados que eliminam planilhas, e-mails e retrabalho.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {features.map((feature, i) => (
              <div
                key={feature.title}
                data-reveal
                className={`group relative rounded-xl border border-border-default bg-bg-elevated p-6 transition-all duration-300 hover:border-border-accent hover:bg-bg-surface delay-${(i + 1) * 100}`}
              >
                <div
                  className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                  style={{ background: `radial-gradient(circle at 50% 0%, ${feature.color}08, transparent 70%)` }}
                />
                <div className="relative">
                  <div
                    className="inline-flex items-center justify-center h-10 w-10 rounded-lg mb-4"
                    style={{ backgroundColor: `${feature.color}15` }}
                  >
                    <svg className="h-5 w-5" style={{ color: feature.color }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d={feature.icon} />
                    </svg>
                  </div>
                  <h3 className="text-base font-bold text-text-primary mb-2">{feature.title}</h3>
                  <p className="text-sm text-text-secondary leading-relaxed">{feature.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PERSONAS ── */}
      <section className="py-20 sm:py-28 border-t border-border-default">
        <div className="mx-auto max-w-6xl px-4">
          <div data-reveal className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-black tracking-tight mb-4">
              Feito para <span className="text-gradient-warm">quem realmente usa</span>
            </h2>
            <p className="text-lg text-text-secondary max-w-2xl mx-auto">
              Cada perfil tem suas dores — e a Aurora resolve todas na mesma plataforma.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {personas.map((persona, i) => (
              <div
                key={persona.role}
                data-reveal
                className={`relative rounded-xl border border-border-default overflow-hidden delay-${(i + 1) * 200}`}
              >
                <div className={`h-1.5 bg-gradient-to-r ${persona.gradient}`} />
                <div className="p-6">
                  <div className="mb-4">
                    <h3 className="text-lg font-bold text-text-primary">{persona.role}</h3>
                  </div>
                  <p className="text-sm text-text-secondary leading-relaxed">{persona.solution}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FINAL CTA ── */}
      <section className="relative py-20 sm:py-28 border-t border-border-default overflow-hidden">
        <div className="absolute inset-0 aurora-glow-strong" />
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] rounded-full bg-violet-500/10 blur-[100px]" />
        <div className="relative mx-auto max-w-3xl px-4 text-center">
          <h2 data-reveal className="text-3xl sm:text-4xl font-black tracking-tight mb-6">
            Pronto para transformar{' '}
            <span className="text-gradient">criadores em mídia?</span>
          </h2>
          <p data-reveal className="text-lg text-text-secondary mb-10 delay-100">
            Crie sua conta em menos de 2 minutos. Sem cartão, sem contrato, sem equipe de vendas.
          </p>
          <div data-reveal className="delay-200">
            <Link
              to="/register"
              className="group relative inline-flex items-center gap-2 rounded-xl bg-violet-500 px-10 py-4 text-lg font-bold text-white transition-all duration-300 hover:bg-violet-600 shadow-[0_0_40px_rgba(139,92,246,0.3)] hover:shadow-[0_0_60px_rgba(139,92,246,0.5)] hover:-translate-y-1"
            >
              Criar conta grátis
              <svg className="h-5 w-5 transition-transform group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
