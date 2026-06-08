/**
 * Auth store — Zustand + expo-secure-store persistence.
 *
 * State:
 *   member        the logged-in member (or null if signed out)
 *   accessToken   short-lived JWT (1h) for API calls
 *   refreshToken  long-lived (90d) token, ONLY for /auth/refresh — never
 *                 attached to other requests
 *   tier          'free' | 'premium' | 'premium_plus' (mirrors backend
 *                 members.subscription_type)
 *
 * Persistence:
 *   accessToken + refreshToken → expo-secure-store (Keychain on iOS,
 *     EncryptedSharedPreferences on Android). Never in async storage.
 *   member object → MMKV (fast, encrypted at rest on supported platforms).
 *
 * Why two stores? Tokens MUST stay in the OS keystore — losing them on
 * an OS update or backup restore is acceptable (forces re-login).
 * Member object is a cache so we don't show a loading flash on cold
 * start.
 */
import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { API_BASE } from '@/lib/api/client';
import { MMKV } from 'react-native-mmkv';

export interface Member {
  id: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  avatar_url?: string;
  tribe_id?: string | null;
  tribe_name?: string | null;
  tribe_color?: string | null;
  subscription_type?: 'free' | 'premium' | 'premium_plus';
  is_admin?: boolean;
  is_ambassador?: boolean;
  is_coach?: boolean;
  is_banned?: boolean;
  member_number?: string;
  joined_at?: string;
}

interface AuthState {
  member: Member | null;
  accessToken: string | null;
  refreshToken: string | null;
  isHydrating: boolean;
  // Actions
  setSession: (member: Member, accessToken: string, refreshToken: string) => Promise<void>;
  updateMember: (patch: Partial<Member>) => void;
  hydrate: () => Promise<void>;
  refresh: () => Promise<boolean>;
  signOut: () => Promise<void>;
}

const memberCache = new MMKV({ id: 'atp-auth-member' });

const KEY_ACCESS  = 'atp.accessToken';
const KEY_REFRESH = 'atp.refreshToken';

export const useAuthStore = create<AuthState>((set, get) => ({
  member: null,
  accessToken: null,
  refreshToken: null,
  isHydrating: true,

  setSession: async (member, accessToken, refreshToken) => {
    await SecureStore.setItemAsync(KEY_ACCESS, accessToken);
    await SecureStore.setItemAsync(KEY_REFRESH, refreshToken);
    memberCache.set('member', JSON.stringify(member));
    set({ member, accessToken, refreshToken, isHydrating: false });
  },

  updateMember: (patch) => {
    set((s) => {
      const next = { ...(s.member || ({} as Member)), ...patch } as Member;
      memberCache.set('member', JSON.stringify(next));
      return { member: next };
    });
  },

  hydrate: async () => {
    try {
      const [access, refresh] = await Promise.all([
        SecureStore.getItemAsync(KEY_ACCESS),
        SecureStore.getItemAsync(KEY_REFRESH),
      ]);
      const cached = memberCache.getString('member');
      const member = cached ? (JSON.parse(cached) as Member) : null;
      set({ accessToken: access, refreshToken: refresh, member, isHydrating: false });
    } catch {
      set({ isHydrating: false });
    }
  },

  /**
   * POST /auth/refresh. Called by the API client interceptor on a 401
   * with code=TOKEN_EXPIRED. Returns true on success, false on
   * permanent failure (token revoked / expired / member banned).
   *
   * Rotates the refresh token — the backend issues a new one and
   * revokes the old. We persist both atomically.
   */
  refresh: async () => {
    const rt = get().refreshToken;
    if (!rt) return false;
    try {
      const res = await fetch(API_BASE + '/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: rt }),
      });
      if (!res.ok) {
        // 401/403 → refresh chain broken; force re-login.
        await get().signOut();
        return false;
      }
      const data = await res.json();
      if (!data || !data.access_token || !data.refresh_token) {
        await get().signOut();
        return false;
      }
      await SecureStore.setItemAsync(KEY_ACCESS, data.access_token);
      await SecureStore.setItemAsync(KEY_REFRESH, data.refresh_token);
      set({ accessToken: data.access_token, refreshToken: data.refresh_token });
      return true;
    } catch {
      // Network failure ≠ token failure — keep the existing tokens and
      // let the next call retry naturally.
      return false;
    }
  },

  signOut: async () => {
    try {
      // Best-effort revoke on the server. Failure here doesn't block local clear.
      const rt = get().refreshToken;
      if (rt) {
        await fetch(API_BASE + '/auth/logout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: rt }),
        }).catch(() => {});
      }
    } finally {
      await SecureStore.deleteItemAsync(KEY_ACCESS).catch(() => {});
      await SecureStore.deleteItemAsync(KEY_REFRESH).catch(() => {});
      memberCache.delete('member');
      set({ member: null, accessToken: null, refreshToken: null });
    }
  },
}));
