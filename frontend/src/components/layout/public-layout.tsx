import { Link, Outlet } from 'react-router-dom';

export function PublicLayout() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-border bg-white">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <Link to="/" className="text-xl font-bold text-primary" aria-label="Aurora - Pagina inicial">
              Aurora
            </Link>
            <nav className="flex items-center gap-4" aria-label="Navegacao principal">
              <Link to="/pricing" className="text-sm text-muted hover:text-text-dark transition-colors">
                Precos
              </Link>
              <Link to="/login" className="text-sm text-muted hover:text-text-dark transition-colors">
                Entrar
              </Link>
              <Link
                to="/register"
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark transition-colors"
              >
                Criar conta
              </Link>
            </nav>
          </div>
        </div>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="border-t border-border bg-white py-6">
        <div className="mx-auto max-w-7xl px-4 text-center text-sm text-muted">
          &copy; {new Date().getFullYear()} Aurora. Todos os direitos reservados.
        </div>
      </footer>
    </div>
  );
}
