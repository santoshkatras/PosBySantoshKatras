'use client';

import type { AuthResponse, Permission, SessionPayload } from '@stockkeep/types';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { api, ApiError } from './api';

type RequestOptions = {
  method?: string;
  body?: unknown;
};

type AuthContextValue = {
  ready: boolean;
  session: SessionPayload | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (body: Record<string, unknown>) => Promise<void>;
  signOut: () => Promise<void>;
  refreshSession: () => Promise<void>;
  request: <T>(path: string, options?: RequestOptions) => Promise<T>;
  can: (permission: Permission) => boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const TOKEN_KEY = 'sk_access';

function sessionFrom(result: AuthResponse): SessionPayload {
  const { accessToken: _token, ...session } = result;
  return session;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [ready, setReady] = useState(false);
  const tokenRef = useRef<string | null>(null);

  const apply = useCallback((accessToken: string, next: SessionPayload) => {
    tokenRef.current = accessToken;
    sessionStorage.setItem(TOKEN_KEY, accessToken);
    setSession(next);
  }, []);

  const clear = useCallback(() => {
    tokenRef.current = null;
    sessionStorage.removeItem(TOKEN_KEY);
    setSession(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = sessionStorage.getItem(TOKEN_KEY);
      try {
        if (stored) {
          const next = await api<SessionPayload>('/auth/me', { token: stored });
          if (!cancelled) apply(stored, next);
          return;
        }
        const refreshed = await api<{ accessToken: string }>('/auth/refresh', { method: 'POST' });
        const next = await api<SessionPayload>('/auth/me', { token: refreshed.accessToken });
        if (!cancelled) apply(refreshed.accessToken, next);
      } catch {
        if (!cancelled) clear();
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apply, clear]);

  const refreshSession = useCallback(async () => {
    const token = tokenRef.current;
    if (!token) return;
    const next = await api<SessionPayload>('/auth/me', { token });
    apply(token, next);
  }, [apply]);

  const request = useCallback(
    async <T,>(path: string, options: RequestOptions = {}): Promise<T> => {
      const send = (token: string | null) =>
        api<T>(path, { method: options.method, body: options.body, token });
      try {
        return await send(tokenRef.current);
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 401) throw error;
        const refreshed = await api<{ accessToken: string }>('/auth/refresh', { method: 'POST' });
        const next = await api<SessionPayload>('/auth/me', { token: refreshed.accessToken });
        apply(refreshed.accessToken, next);
        return send(refreshed.accessToken);
      }
    },
    [apply],
  );

  const signIn = useCallback(
    async (email: string, password: string) => {
      const result = await api<AuthResponse>('/auth/login', {
        method: 'POST',
        body: { email, password },
      });
      apply(result.accessToken, sessionFrom(result));
    },
    [apply],
  );

  const signUp = useCallback(
    async (body: Record<string, unknown>) => {
      const result = await api<AuthResponse>('/auth/signup', { method: 'POST', body });
      apply(result.accessToken, sessionFrom(result));
    },
    [apply],
  );

  const signOut = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      clear();
    }
  }, [clear]);

  const can = useCallback(
    (permission: Permission) => session?.user.permissions.includes(permission) ?? false,
    [session],
  );

  const value = useMemo(
    () => ({ ready, session, signIn, signUp, signOut, refreshSession, request, can }),
    [ready, session, signIn, signUp, signOut, refreshSession, request, can],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within AuthProvider');
  return value;
}
