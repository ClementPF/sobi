import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { api } from '@/api/client';
import { exchangeGoogleCode, getMe, logoutSession, updateMe } from '@/api/endpoints';
import type { GoogleCodeExchangeRequest, Units, User } from '@/api/types';
import { Colors, Palette, Spacing, Typography } from '@/theme';

import { requestDevSession } from './devSession';
import { sessionStore, type SessionStore } from './session-store';
import type { StoredSession } from './storage';

export type SessionStatus = 'loading' | 'authenticated' | 'unauthenticated';

export interface SessionContextValue {
  status: SessionStatus;
  session: StoredSession | null;
  user: User | null;
  /** Sends a Google authorization code (+ PKCE verifier) to the backend for a session. */
  loginWithGoogleCode(exchange: GoogleCodeExchangeRequest): Promise<void>;
  /** Non-production only: signs in through /auth/dev-token. */
  loginWithDevUser(email: string): Promise<void>;
  logout(): Promise<void>;
  /** Saves the display unit preference on the account. */
  setUnits(units: Units): Promise<void>;
  /** Rotates tokens; resolves false when the session was lost. */
  refresh(): Promise<boolean>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export interface SessionProviderProps {
  children: ReactNode;
  /** Owns session cleanup (storage, query cache, auth-lost) for sign-out and expiry. */
  store?: SessionStore;
  refreshTokens?: () => Promise<string | null>;
  /**
   * Checks a restored session against the server (GET /me). The API client refreshes an
   * expired access token, or clears the session when the refresh token is no longer accepted.
   */
  fetchCurrentUser?: () => Promise<User>;
  /** Rendered while stored tokens hydrate, so the app never shows a blank screen. */
  fallback?: ReactNode;
}

export function SessionLoading() {
  return (
    <View style={styles.loading} accessibilityLabel="Loading session">
      <ActivityIndicator size="large" color={Colors.accent} />
      <Text style={Typography.bodySecondary}>Loading…</Text>
    </View>
  );
}

export function SessionProvider({
  children,
  store = sessionStore,
  refreshTokens = api.refresh,
  fetchCurrentUser = getMe,
  fallback,
}: SessionProviderProps) {
  const [hydrated, setHydrated] = useState(false);
  const [session, setSession] = useState<StoredSession | null>(store.get());

  useEffect(() => {
    const unsubscribe = store.subscribe(setSession);
    let active = true;
    void (async () => {
      const restored = await store.hydrate();
      if (restored) {
        const generation = store.generation();
        try {
          await store.updateUser(await fetchCurrentUser(), generation);
        } catch {
          // A rejected refresh already cleared the session; any other failure (offline, server
          // error) keeps the stored session so the app still opens.
        }
      }
      if (!active) return;
      setSession(store.get());
      setHydrated(true);
    })();
    return () => {
      active = false;
      unsubscribe();
    };
  }, [store, fetchCurrentUser]);

  const loginWithGoogleCode = useCallback(
    async (exchange: GoogleCodeExchangeRequest) => {
      await store.set(await exchangeGoogleCode(exchange));
    },
    [store],
  );

  const loginWithDevUser = useCallback(
    async (email: string) => {
      await store.set(await requestDevSession(email));
    },
    [store],
  );

  const logout = useCallback(async () => {
    const generation = store.generation();
    const refreshToken = store.get()?.refreshToken;
    // Local sign-out must succeed even if the server cannot be reached.
    if (refreshToken) await logoutSession(refreshToken).catch(() => undefined);
    // Skipped by the store if a login completed meanwhile; the store also clears the cache.
    await store.clear(generation);
  }, [store]);

  const setUnits = useCallback(
    async (units: Units) => {
      const generation = store.generation();
      await store.updateUser(await updateMe({ units }), generation);
    },
    [store],
  );

  const refresh = useCallback(async () => (await refreshTokens()) !== null, [refreshTokens]);

  const value = useMemo<SessionContextValue>(
    () => ({
      status: !hydrated ? 'loading' : session ? 'authenticated' : 'unauthenticated',
      session,
      user: session?.user ?? null,
      loginWithGoogleCode,
      loginWithDevUser,
      logout,
      setUnits,
      refresh,
    }),
    [hydrated, session, loginWithGoogleCode, loginWithDevUser, logout, setUnits, refresh],
  );

  return (
    <SessionContext.Provider value={value}>
      {hydrated ? children : (fallback ?? <SessionLoading />)}
    </SessionContext.Provider>
  );
}

/** The signed-in user's unit system; sessions stored before the preference existed read as metric. */
export function useUnits(): Units {
  return useSession().user?.units ?? 'metric';
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside <SessionProvider>');
  return value;
}

const styles = StyleSheet.create({
  loading: {
    ...Palette.screen,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
  },
});
