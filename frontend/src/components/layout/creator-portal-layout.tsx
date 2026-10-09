import { Link, Outlet, useNavigate } from 'react-router-dom';
import { clearCreatorToken, getCreatorToken } from '@/lib/api-client';

/**
 * Layout for the creator-facing opportunity portal (US-28). Creators are not account
 * members (no X-Account-Id, no workspace), so this is a separate shell from AppLayout.
 */
export function CreatorPortalLayout() {
  const navigate = useNavigate();
  const hasToken = !!getCreatorToken();

  const handleLogout = () => {
    clearCreatorToken();
    navigate('/creator-portal/access');
  };

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-border bg-white">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <Link to="/creator-portal/opportunities" className="text-xl font-bold text-primary">
              Aurora
            </Link>
            {hasToken && (
              <button onClick={handleLogout} className="text-sm text-muted hover:text-error transition-colors">
                Sair
              </button>
            )}
          </div>
        </div>
      </header>
      <main className="flex-1 p-4 sm:p-6 lg:p-8">
        <Outlet />
      </main>
    </div>
  );
}
