import { Link, Outlet } from 'react-router-dom';

export function PublicLayout() {
  return (
    <div className="min-h-screen flex flex-col bg-bg">
      <header className="fixed top-0 left-0 right-0 z-50 glass border-b border-border-default">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <Link to="/" className="text-xl font-bold text-gradient" aria-label="Aurora - Pagina inicial">
              Aurora
            </Link>
            <nav className="flex items-center gap-6" aria-label="Navegação principal">
              <Link to="/login" className="text-sm text-text-secondary hover:text-text-primary transition-colors">
                Entrar
              </Link>
              <Link
                to="/register"
                className="rounded-lg bg-violet-500 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-600 transition-all duration-200 shadow-[0_0_20px_rgba(139,92,246,0.2)] hover:shadow-[0_0_24px_rgba(139,92,246,0.35)]"
              >
                Criar conta
              </Link>
            </nav>
          </div>
        </div>
      </header>
      <main className="flex-1 pt-16">
        <Outlet />
      </main>
      <footer className="border-t border-border-default py-8">
        <div className="mx-auto max-w-7xl px-4 text-center text-sm text-text-muted">
          &copy; {new Date().getFullYear()} Aurora. Todos os direitos reservados.
        </div>
      </footer>
    </div>
  );
}
