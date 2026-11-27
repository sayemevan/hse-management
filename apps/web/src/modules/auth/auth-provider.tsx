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

import { ApiClientError } from '@/services/api-client';
import { forgetOfflineSession, usableOfflineProfile } from '@/modules/offline/offline-profile';

import { clearAccessToken, onSessionEnded, refreshAccessToken } from './auth-session';
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
  /**
   * PLT-27 (T-73): signed in from the device's offline profile because the network is down.
   * No token exists; capture screens queue their changes.
   */
  offline: boolean;
  /** Back online: restore the real session (or end offline mode if it is over). */
  reconnect: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** A request that never reached the server (PLT-27 FR-3), unlike a session the server ended. */
export function isNetworkFailure(error: unknown): boolean {
  return error instanceof ApiClientError && error.status === 0;
}

/**
 * Session state for the whole app. On load it silently restores the session from the refresh
 * cookie (US-001 "session restored via refresh after reloading the page").
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUserState] = useState<CurrentUserDto | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const effect = { cancelled: false };
    void (async () => {
      try {
        const restored = (await refreshAccessToken()) ? await authService.me() : null;
        if (effect.cancelled) return;
        setUserState(restored);
        setStatus(restored ? 'signed-in' : 'signed-out');
      } catch (error) {
        // PLT-27: no network. Open on the offline profile when one is fresh enough (O-118).
        const profile = isNetworkFailure(error) ? await usableOfflineProfile() : null;
        if (effect.cancelled) return;
        if (profile) {
          setUserState(profile.user);
          setOffline(true);
          setStatus('signed-in');
        } else {
          setStatus('signed-out');
        }
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

  const reconnect = useCallback(async () => {
    try {
      const restored = (await refreshAccessToken()) ? await authService.me() : null;
      if (restored) {
        setUserState(restored);
        setOffline(false);
      } else {
        // The session ended while offline: sign in again to finish syncing (PLT-27).
        clearAccessToken();
        setUserState(null);
        setOffline(false);
        setStatus('signed-out');
      }
    } catch {
      // Still no network: stay offline.
    }
  }, []);

  const signIn = useCallback(async (request: LoginRequest) => {
    const signedIn = await authService.login(request);
    setUserState(signedIn);
    setOffline(false);
    setStatus('signed-in');
    return signedIn;
  }, []);

  const signOut = useCallback(async () => {
    try {
      await forgetOfflineSession().catch(() => undefined);
      await authService.logout();
    } finally {
      setUserState(null);
      setOffline(false);
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
    () => ({ status, user, signIn, signOut, setUser, adoptSession, offline, reconnect }),
    [status, user, signIn, signOut, setUser, adoptSession, offline, reconnect],
  );
  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
