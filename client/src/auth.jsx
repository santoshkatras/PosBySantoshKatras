import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';

const AuthContext = createContext(null);
const TOKEN_KEY = 'sk_access';

function sessionFrom(result) {
  const { accessToken: _token, ...session } = result;
  return session;
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(false);
  const tokenRef = useRef(null);

  const apply = useCallback((accessToken, next) => {
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
          const next = await api('/auth/me', { token: stored });
          if (!cancelled) apply(stored, next);
          return;
        }
        const refreshed = await api('/auth/refresh', { method: 'POST' });
        const next = await api('/auth/me', { token: refreshed.accessToken });
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

  const request = useCallback(async (path, options = {}) => {
    try {
      return await api(path, { ...options, token: tokenRef.current });
    } catch (error) {
      if (error.status !== 401) throw error;
      const refreshed = await api('/auth/refresh', { method: 'POST' });
      tokenRef.current = refreshed.accessToken;
      sessionStorage.setItem(TOKEN_KEY, refreshed.accessToken);
      return api(path, { ...options, token: refreshed.accessToken });
    }
  }, []);

  const signIn = useCallback(async (email, password) => {
    const result = await api('/auth/login', { method: 'POST', body: { email, password } });
    apply(result.accessToken, sessionFrom(result));
  }, [apply]);

  const signUp = useCallback(async (body) => {
    const result = await api('/auth/signup', { method: 'POST', body });
    apply(result.accessToken, sessionFrom(result));
  }, [apply]);

  const signOut = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      clear();
    }
  }, [clear]);

  const refreshSession = useCallback(async () => {
    const next = await request('/auth/me');
    setSession(next);
  }, [request]);

  const value = useMemo(() => ({
    ready,
    session,
    signIn,
    signUp,
    signOut,
    refreshSession,
    request,
    can: (permission) => Boolean(session?.user.permissions.includes(permission)),
  }), [ready, session, signIn, signUp, signOut, refreshSession, request]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('Auth missing');
  return value;
}
