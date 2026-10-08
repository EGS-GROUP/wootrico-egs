import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, getToken, setToken } from './api-client';

export interface AdminUser {
  email: string;
}

interface AuthState {
  user: AdminUser | null;
  loading: boolean;
  login: (token: string, user: AdminUser) => void;
  logout: () => void;
}

const AuthCtx = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    // /admin/me just validates the token; reconstruct the user from storage.
    api<{ ok: boolean }>('/admin/me')
      .then(() => setUser({ email: localStorage.getItem('wootrico.license-admin.email') ?? '' }))
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      login: (token, u) => {
        setToken(token);
        localStorage.setItem('wootrico.license-admin.email', u.email);
        setUser(u);
      },
      logout: () => {
        setToken(null);
        localStorage.removeItem('wootrico.license-admin.email');
        setUser(null);
      },
    }),
    [user, loading],
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
