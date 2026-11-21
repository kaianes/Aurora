import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { clearCreatorToken, getCreatorToken } from '@/lib/api-client';

export function CreatorPortalLayout() {
  const navigate = useNavigate();
  const hasToken = !!getCreatorToken();

  const handleLogout = () => {
    clearCreatorToken();
    navigate('/login');
  };

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `text-sm transition-colors ${
      isActive ? 'text-violet-400 font-medium' : 'text-text-muted hover:text-text-primary'
    }`;

  return (
    <div className="min-h-screen flex flex-col bg-bg">
      <header className="border-b border-border-default bg-aurora-950">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-14 items-center justify-between">
            <Link to="/creator-portal/home" className="text-lg font-bold text-gradient-warm">
              Aurora
            </Link>
            <div className="flex items-center gap-5">
              {hasToken && (
                <>
                  <NavLink to="/creator-portal/home" className={linkClass}>Início</NavLink>
                  <NavLink to="/creator-portal/opportunities" className={linkClass}>Oportunidades</NavLink>
                  <NavLink to="/creator-portal/payments" className={linkClass}>Pagamentos</NavLink>
                  <NavLink to="/creator-portal/performance" className={linkClass}>Desempenho</NavLink>
                  <NavLink to="/creator-portal/social-accounts" className={linkClass}>Redes</NavLink>
                  <NavLink to="/creator-portal/rate-preferences" className={linkClass}>Valores</NavLink>
                  <NavLink to="/creator-portal/media-kit" className={linkClass}>Media kit</NavLink>
                  <button onClick={handleLogout} className="text-sm text-text-muted hover:text-error transition-colors">
                    Sair
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </header>
      <main className="flex-1 p-4 sm:p-6 lg:p-8 bg-aurora-900">
        <Outlet />
      </main>
    </div>
  );
}
