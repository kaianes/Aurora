import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/auth-context';

const navItems = [
  { to: '/app/brand-profile', label: 'Perfil da Marca', icon: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4' },
  { to: '/app/campaigns', label: 'Campanhas', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
  { to: '/app/templates', label: 'Modelos', icon: 'M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2' },
  { to: '/app/exclusions', label: 'Exclusoes', icon: 'M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636' },
  { to: '/app/safety/ruleset', label: 'Brand Safety', icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z' },
  { to: '/app/safety/review-queue', label: 'Fila de Revisao', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4' },
  { to: '/app/safety/monitoring', label: 'Monitoramento', icon: 'M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z' },
  { to: '/app/team', label: 'Equipe', icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z' },
  { to: '/app/security', label: 'Segurança', icon: 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z' },
];

const agencyItems = [
  { to: '/app/clients', label: 'Clientes', icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z' },
  { to: '/app/reports/compare', label: 'Comparar Clientes', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
  { to: '/app/agency/branding', label: 'Marca da Agencia', icon: 'M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01' },
  { to: '/app/audit-log', label: 'Auditoria', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
];

function NavIcon({ path }: { path: string }) {
  return (
    <svg className="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d={path} />
    </svg>
  );
}

export function AppLayout() {
  const { user, workspace, logout, switchAccount } = useAuth();
  const navigate = useNavigate();
  const isAgency = workspace?.workspace?.type === 'agency';

  const homeAccount = workspace?.accounts.find((a) => a.is_home);
  const clientAccounts = workspace?.accounts.filter((a) => !a.is_home) ?? [];
  const currentAccount = workspace?.accounts.find((a) => a.id === workspace.current_account.id);
  const actingOnBehalfOfClient = isAgency && currentAccount && !currentAccount.is_home;

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150 ${
      isActive
        ? 'bg-primary-muted text-primary'
        : 'text-text-muted hover:bg-bg-hover hover:text-text-primary'
    }`;

  return (
    <div className="min-h-screen flex flex-col bg-bg">
      <header className="border-b border-border-default bg-aurora-950">
        <div className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-8">
          <div className="flex h-14 items-center justify-between">
            <Link to="/app/brand-profile" className="text-lg font-bold text-gradient">
              Aurora
            </Link>
            <div className="flex items-center gap-4">
              {isAgency && workspace && workspace.accounts.length > 1 && (
                <select
                  value={workspace.current_account.id}
                  onChange={(e) => switchAccount(e.target.value)}
                  className="rounded-lg border border-border-default bg-bg-elevated px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-violet-500/30"
                  aria-label="Selecionar conta"
                >
                  {homeAccount && (
                    <optgroup label="Minha agencia">
                      <option value={homeAccount.id}>{homeAccount.name}</option>
                    </optgroup>
                  )}
                  {clientAccounts.length > 0 && (
                    <optgroup label="Clientes">
                      {clientAccounts.map((acc) => (
                        <option key={acc.id} value={acc.id}>
                          {acc.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              )}
              <span className="text-sm text-text-muted">{user?.name}</span>
              <button
                onClick={handleLogout}
                className="text-sm text-text-muted hover:text-error transition-colors"
              >
                Sair
              </button>
            </div>
          </div>
        </div>
        {actingOnBehalfOfClient && (
          <div className="border-t border-border-subtle bg-primary-muted">
            <div className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-8 py-1.5">
              <p className="font-mono text-xs text-violet-400">
                <span className="inline-block h-2 w-2 rounded-full bg-violet-400 mr-2" />
                Atuando em nome de: {currentAccount.name}
              </p>
            </div>
          </div>
        )}
      </header>
      <div className="flex flex-1">
        <aside className="hidden md:flex w-56 flex-col border-r border-border-default bg-aurora-950 p-3" aria-label="Menu lateral">
          <nav className="flex flex-col gap-0.5">
            {navItems.map((item) => (
              <NavLink key={item.to} to={item.to} className={navLinkClass}>
                <NavIcon path={item.icon} />
                {item.label}
              </NavLink>
            ))}
            {isAgency && (
              <>
                <div className="my-2 border-t border-border-subtle" />
                {agencyItems.map((item) => (
                  <NavLink key={item.to} to={item.to} className={navLinkClass}>
                    <NavIcon path={item.icon} />
                    {item.label}
                  </NavLink>
                ))}
              </>
            )}
          </nav>
        </aside>
        <main className="flex-1 p-4 sm:p-6 lg:p-8 bg-aurora-900">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
