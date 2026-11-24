'use client';

import type { CurrentUserDto, LoginRequest } from '@hse/shared';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { onSessionEnded, refreshAccessToken } from './auth-session';
import { authService } from './auth.service';

export type AuthStatus = 'loading' | 'signed-out' | 'signed-in' | 'expired';

interface AuthContextValue {
  status: AuthStatus;
  user: CurrentUserDto | null;
  signIn: (request: LoginRequest) => Promise<CurrentUserDto>;
  signOut: () => Promise<void>;
  setUser: (user: CurrentUserDto) => void;
  /** A session started outside `signIn`, e.g. by accepting an invitation (US-006). */
  adoptSession: (user: CurrentUserDto) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Session state for the whole app. On load it silently restores the session from the refresh
 * cookie (US-001 "session restored via refresh after reloading the page").
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUserState] = useState<CurrentUserDto | null>(null);

  useEffect(() => {
    const effect = { cancelled: false };
    void (async () => {
      try {
        const restored = (await refreshAccessToken()) ? await authService.me() : null;
        if (effect.cancelled) return;
        setUserState(restored);
        setStatus(restored ? 'signed-in' : 'signed-out');
      } catch {
        if (!effect.cancelled) setStatus('signed-out');
      }
    })();
    return () => {
      effect.cancelled = true;
    };
  }, []);

  // A request found the session over (expired, revoked elsewhere, account suspended).
  useEffect(
    () =>
      onSessionEnded(() => {
        setUserState(null);
        setStatus((current) => (current === 'signed-in' ? 'expired' : 'signed-out'));
      }),
    [],
  );

  const signIn = useCallback(async (request: LoginRequest) => {
    const signedIn = await authService.login(request);
    setUserState(signedIn);
    setStatus('signed-in');
    return signedIn;
  }, []);

  const signOut = useCallback(async () => {
    try {
      await authService.logout();
    } finally {
      setUserState(null);
      setStatus('signed-out');
    }
  }, []);

  const setUser = useCallback((next: CurrentUserDto) => {
    setUserState(next);
  }, []);

  const adoptSession = useCallback((next: CurrentUserDto) => {
    setUserState(next);
    setStatus('signed-in');
  }, []);

  const value = useMemo(
    () => ({ status, user, signIn, signOut, setUser, adoptSession }),
    [status, user, signIn, signOut, setUser, adoptSession],
  );
  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
