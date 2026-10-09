import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  clearTokens,
  getAccessToken,
  setCurrentAccountId,
  setTokens,
} from '@/lib/api-client';
import { workspaceApi } from '@/lib/api-client';
import type { Membership, Role, WorkspaceResponse } from '@/types/api';

interface User {
  id: string;
  email: string;
  name: string;
  mfa_enabled: boolean;
}

interface AuthState {
  user: User | null;
  memberships: Membership[];
  workspace: WorkspaceResponse | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  currentRole: Role | null;
}

interface AuthContextType extends AuthState {
  login: (accessToken: string, refreshToken: string, user: User, memberships: Membership[]) => void;
  logout: () => void;
  refreshWorkspace: () => Promise<void>;
  switchAccount: (accountId: string) => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

const USER_KEY = 'aurora_user';
const MEMBERSHIPS_KEY = 'aurora_memberships';

function loadStoredUser(): User | null {
  try {
    const stored = localStorage.getItem(USER_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

function loadStoredMemberships(): Membership[] {
  try {
    const stored = localStorage.getItem(MEMBERSHIPS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(loadStoredUser);
  const [memberships, setMemberships] = useState<Membership[]>(loadStoredMemberships);
  const [workspace, setWorkspace] = useState<WorkspaceResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const isAuthenticated = !!user && !!getAccessToken();
  const currentRole = workspace?.current_account?.role ?? memberships[0]?.role ?? null;

  const refreshWorkspace = useCallback(async () => {
    if (!getAccessToken()) return;
    try {
      const ws = await workspaceApi.getCurrent();
      setWorkspace(ws);
      if (ws.current_account) {
        setCurrentAccountId(ws.current_account.id);
      }
    } catch {
      // workspace fetch failed, user may still be authenticated
    }
  }, []);

  useEffect(() => {
    if (getAccessToken() && user) {
      refreshWorkspace().finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
  }, [user, refreshWorkspace]);

  const login = useCallback(
    (accessToken: string, refreshToken: string, u: User, m: Membership[]) => {
      setTokens(accessToken, refreshToken);
      localStorage.setItem(USER_KEY, JSON.stringify(u));
      localStorage.setItem(MEMBERSHIPS_KEY, JSON.stringify(m));
      setUser(u);
      setMemberships(m);
      if (m.length > 0) {
        setCurrentAccountId(m[0].account_id);
      }
    },
    [],
  );

  const logout = useCallback(() => {
    clearTokens();
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(MEMBERSHIPS_KEY);
    localStorage.removeItem('aurora_account_id');
    setUser(null);
    setMemberships([]);
    setWorkspace(null);
  }, []);

  const switchAccount = useCallback(
    (accountId: string) => {
      setCurrentAccountId(accountId);
      refreshWorkspace();
    },
    [refreshWorkspace],
  );

  const value = useMemo(
    () => ({
      user,
      memberships,
      workspace,
      isAuthenticated,
      isLoading,
      currentRole,
      login,
      logout,
      refreshWorkspace,
      switchAccount,
    }),
    [user, memberships, workspace, isAuthenticated, isLoading, currentRole, login, logout, refreshWorkspace, switchAccount],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
