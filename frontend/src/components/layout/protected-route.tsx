import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/auth-context';
import { Spinner } from '@/components/ui/spinner';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredWorkspaceType?: 'brand' | 'agency';
}

export function ProtectedRoute({ children, requiredWorkspaceType }: ProtectedRouteProps) {
  const { isAuthenticated, isLoading, workspace } = useAuth();

  if (isLoading) {
    return <Spinner />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (requiredWorkspaceType && workspace && workspace.workspace.type !== requiredWorkspaceType) {
    return <Navigate to="/app/brand-profile" replace />;
  }

  return <>{children}</>;
}
