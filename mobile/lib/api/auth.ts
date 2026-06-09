/**
 * Auth API — wraps the v1.69+ /api/auth endpoints.
 *
 * Every method that returns a session (login / register / apple / google /
 * verifyMagicLink) calls useAuthStore.setSession() so the rest of the app
 * picks up the new tokens + member immediately. Components don't need to
 * touch the store directly.
 */
import { api, ApiError } from './client';
import { useAuthStore, type Member } from '@/lib/stores/auth.store';

interface MobileAuthResponse {
  access_token: string;
  refresh_token: string | null;
  // Legacy alias for compatibility with the dual-shape backend response.
  token?: string;
  member: Member;
}

export class AccountSuspendedError extends Error {
  constructor(message = 'Account suspended') {
    super(message);
    this.name = 'AccountSuspendedError';
  }
}

function isSuspendedError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 403 && /suspended/i.test(err.message || '');
}

/**
 * Email + password login. Throws AccountSuspendedError on 403 so the
 * Welcome / Login screens can route to /(auth)/suspended.
 */
export async function login(email: string, password: string): Promise<Member> {
  try {
    const res = await api.post<MobileAuthResponse>('/auth/login', { email, password });
    if (res.access_token && res.refresh_token) {
      await useAuthStore.getState().setSession(res.member, res.access_token, res.refresh_token);
    } else if (res.token) {
      // Backend didn't issue a refresh token (pre-D1 deploy or
      // X-Mobile-Platform header lost). Use the legacy JWT as both
      // tokens — refresh will fall back to forcing re-login on
      // expiry, which is fine.
      await useAuthStore.getState().setSession(res.member, res.token, res.token);
    }
    return res.member;
  } catch (err) {
    if (isSuspendedError(err)) throw new AccountSuspendedError();
    throw err;
  }
}

/**
 * Registration. Same response shape as login.
 */
export async function register(payload: {
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  password: string;
}): Promise<Member> {
  const res = await api.post<MobileAuthResponse>('/auth/register', payload);
  const refresh = res.refresh_token || res.token || res.access_token;
  await useAuthStore.getState().setSession(res.member, res.access_token || res.token!, refresh!);
  return res.member;
}

/**
 * Apple Sign-In. The native expo-apple-authentication module gives us
 * a JWT identity_token + (on first sign-in only) a fullName. The
 * backend's /auth/apple route verifies the token against Apple's JWKS,
 * maps the Apple `sub` to a member, creates one on first sign-in.
 */
export async function signInWithApple(payload: {
  identity_token: string;
  full_name?: { givenName: string | null; familyName: string | null };
}): Promise<Member> {
  try {
    const res = await api.post<MobileAuthResponse>('/auth/apple', payload);
    const refresh = res.refresh_token || res.access_token;
    await useAuthStore.getState().setSession(res.member, res.access_token, refresh);
    return res.member;
  } catch (err) {
    if (isSuspendedError(err)) throw new AccountSuspendedError();
    throw err;
  }
}

/**
 * Google Sign-In. We get an id_token from expo-auth-session's Google
 * provider; backend's existing /auth/google route already verifies
 * it against Google's JWKS.
 */
export async function signInWithGoogle(id_token: string): Promise<Member> {
  try {
    const res = await api.post<MobileAuthResponse>('/auth/google', { id_token });
    const refresh = res.refresh_token || res.access_token || res.token!;
    const access  = res.access_token || res.token!;
    await useAuthStore.getState().setSession(res.member, access, refresh);
    return res.member;
  } catch (err) {
    if (isSuspendedError(err)) throw new AccountSuspendedError();
    throw err;
  }
}

/**
 * Step 1: request a magic-link email. Server emails the user a link
 * that opens the app via universal link to /(auth)/magic-link-callback?token=…
 */
export async function requestMagicLink(email: string): Promise<void> {
  await api.post('/auth/magic-link', { email });
}

/**
 * Step 2 (from magic-link-callback screen): verify the token, log in.
 */
export async function verifyMagicLink(token: string, email: string): Promise<Member> {
  try {
    const res = await api.get<MobileAuthResponse & { isFirstLogin?: boolean }>(
      `/auth/verify?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`
    );
    const refresh = res.refresh_token || res.access_token || res.token!;
    const access  = res.access_token || res.token!;
    await useAuthStore.getState().setSession(res.member, access, refresh);
    return res.member;
  } catch (err) {
    if (isSuspendedError(err)) throw new AccountSuspendedError();
    throw err;
  }
}

/**
 * Re-hydrate member data from the server. Called on app foreground +
 * after profile edits so we always show fresh data.
 */
export async function me(): Promise<Member> {
  const res = await api.get<{ member: Member }>('/auth/me');
  useAuthStore.getState().updateMember(res.member);
  return res.member;
}

/**
 * Sign out from THIS device only.
 */
export async function logout(): Promise<void> {
  await useAuthStore.getState().signOut();
}

/**
 * Sign out from EVERY device. Server revokes all refresh tokens.
 */
export async function logoutAllDevices(): Promise<void> {
  try {
    await api.post('/auth/logout-all-devices');
  } finally {
    await useAuthStore.getState().signOut();
  }
}
