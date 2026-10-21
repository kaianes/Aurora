import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/auth-context';

export function AppLayout() {
  const { user, workspace, logout, switchAccount } = useAuth();
  const navigate = useNavigate();
  const isAgency = workspace?.workspace?.type === 'agency';

  // US-39 (E9): the home account is the agency's own; every other account in the workspace
  // is a client. Grouping the existing flat list gives Renata the structure she needs to tell
  // them apart at a glance, without any new API call or state (section 6 of the E9 arch doc).
  const homeAccount = workspace?.accounts.find((a) => a.is_home);
  const clientAccounts = workspace?.accounts.filter((a) => !a.is_home) ?? [];
  const currentAccount = workspace?.accounts.find((a) => a.id === workspace.current_account.id);
  const actingOnBehalfOfClient = isAgency && currentAccount && !currentAccount.is_home;

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
      isActive ? 'bg-primary/10 text-primary' : 'text-muted hover:bg-surface hover:text-text-dark'
    }`;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-border bg-white">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <Link to="/app/brand-profile" className="text-xl font-bold text-primary">
              Aurora
            </Link>
            <div className="flex items-center gap-4">
              {isAgency && workspace && workspace.accounts.length > 1 && (
                <select
                  value={workspace.current_account.id}
                  onChange={(e) => switchAccount(e.target.value)}
                  className="rounded-lg border border-border px-3 py-1.5 text-sm"
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
              <span className="text-sm text-muted">{user?.name}</span>
              <button
                onClick={handleLogout}
                className="text-sm text-muted hover:text-error transition-colors"
              >
                Sair
              </button>
            </div>
          </div>
        </div>
        {actingOnBehalfOfClient && (
          <div className="bg-surface border-t border-border">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-1.5">
              <p className="font-mono text-xs text-text-dark">
                <span
                  className="inline-block h-2 w-2 rounded-full mr-2"
                  style={{ backgroundColor: 'var(--color-strategy-violet)' }}
                />
                Atuando em nome de: {currentAccount.name}
              </p>
            </div>
          </div>
        )}
      </header>
      <div className="flex flex-1">
        <aside className="hidden md:flex w-60 flex-col border-r border-border bg-white p-4" aria-label="Menu lateral">
          <nav className="flex flex-col gap-1">
            <NavLink to="/app/brand-profile" className={navLinkClass}>
              Perfil da Marca
            </NavLink>
            <NavLink to="/app/campaigns" className={navLinkClass}>
              Campanhas
            </NavLink>
            <NavLink to="/app/templates" className={navLinkClass}>
              Modelos
            </NavLink>
            <NavLink to="/app/exclusions" className={navLinkClass}>
              Lista de Exclusao
            </NavLink>
            <NavLink to="/app/safety/ruleset" className={navLinkClass}>
              Regras de Seguranca
            </NavLink>
            <NavLink to="/app/safety/review-queue" className={navLinkClass}>
              Fila de Revisao
            </NavLink>
            <NavLink to="/app/safety/monitoring" className={navLinkClass}>
              Monitoramento
            </NavLink>
            <NavLink to="/app/team" className={navLinkClass}>
              Equipe
            </NavLink>
            {isAgency && (
              <NavLink to="/app/clients" className={navLinkClass}>
                Clientes
              </NavLink>
            )}
            {isAgency && (
              <NavLink to="/app/reports/compare" className={navLinkClass}>
                Comparar Clientes
              </NavLink>
            )}
            {isAgency && (
              <NavLink to="/app/agency/branding" className={navLinkClass}>
                Marca da Agencia
              </NavLink>
            )}
            {isAgency && (
              <NavLink to="/app/audit-log" className={navLinkClass}>
                Registro de Auditoria
              </NavLink>
            )}
          </nav>
        </aside>
        <main className="flex-1 p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
