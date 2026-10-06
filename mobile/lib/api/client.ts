/**
 * ATP mobile API client.
 *
 * Thin wrapper around fetch with:
 *   - Bearer auth header from Zustand store
 *   - Automatic 401 → /auth/refresh → retry once (refresh-token interceptor)
 *   - Typed error class so screens can branch on status / code
 *   - X-Mobile-App-Version + X-Mobile-Platform headers for backend analytics
 *
 * The base URL is read from Expo Constants. Staging vs production swap
 * via env config (env/.env.staging vs env/.env.production).
 */
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import * as Application from 'expo-application';
import { useAuthStore } from '@/lib/stores/auth.store';

type Extra = {
  apiBaseUrl?: string;
  apiBaseUrlStaging?: string;
};

const extra = (Constants.expoConfig?.extra || {}) as Extra;

// Default to production. Staging build profile overrides via app.json env injection.
export const API_BASE = process.env.EXPO_PUBLIC_API_BASE
  || extra.apiBaseUrl
  || 'https://atp-world-web.onrender.com/api';

// Base URL for every link the app opens ON the website (privacy, terms,
// coach pages, referral join, blog shares). ONE constant to flip at the
// atthepark.world DNS cutover — the legacy domain still serves the OLD
// site, so linking there today lands members on dead pages.
export const WEB_BASE = API_BASE.replace(/\/api\/?$/, '');

export class ApiError extends Error {
  status: number;
  code?: string;
  data?: any;
  constructor(message: string, status: number, data?: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
    this.code = data && data.code;
  }
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: any;
  retried?: boolean;
}

/** `exp` (seconds since epoch) of a JWT, or null when it can't be read. */
function jwtExp(token: string): number | null {
  try {
    const part = token.split('.')[1];
    if (!part || typeof atob !== 'function') return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(b64 + '==='.slice((b64.length + 3) % 4)));
    return typeof claims.exp === 'number' ? claims.exp : null;
  } catch {
    return null;
  }
}

async function request<T = any>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  const { body, retried, headers: extraHeaders, ...rest } = opts;
  // Access tokens last 1h, so after the app has been closed for a while
  // the stored one has lapsed. Renew it BEFORE sending rather than letting
  // every screen's first request bounce off a 401. The 401 path below
  // stays as the fallback (clock skew, unreadable token).
  const auth = useAuthStore.getState();
  if (!retried && auth.accessToken && auth.refreshToken && auth.refreshToken !== auth.accessToken) {
    const exp = jwtExp(auth.accessToken);
    if (exp !== null && exp - 30 < Date.now() / 1000) await auth.refresh();
  }
  const token = useAuthStore.getState().accessToken;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Mobile-Platform': Platform.OS,
    'X-Mobile-App-Version': Application.nativeApplicationVersion || '0.0.0',
    ...((extraHeaders as Record<string, string>) || {}),
  };
  if (token) headers['Authorization'] = 'Bearer ' + token;

  const res = await fetch(API_BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    ...rest,
  });

  // Refresh-token interceptor (R-AUTH-mobile). On 401 with TOKEN_EXPIRED,
  // try to refresh once. If refresh succeeds, retry the original request
  // with the new token. If refresh fails, the auth store clears tokens +
  // navigates to the welcome screen via the auth gate in _layout.tsx.
  // Concurrent 401s share one refresh call (see auth.store refresh()).
  let body401: any = null;
  if (res.status === 401 && !retried) {
    body401 = await res.json().catch(() => ({}));
    if (body401.code === 'TOKEN_EXPIRED' || body401.code === 'NO_TOKEN') {
      const refreshed = await useAuthStore.getState().refresh();
      if (refreshed) {
        return request<T>(method, path, { ...opts, retried: true });
      }
      // refresh failed → fall through and surface the 401 below
    }
  }

  if (res.status === 204) return undefined as unknown as T;

  // The 401 body was already read above — a second res.json() would fail
  // and turn the server's message into a generic "Request failed".
  const json = body401 ?? await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(json.error || json.message || 'Request failed', res.status, json);
  }
  return json as T;
}

export const api = {
  get:    <T = any>(p: string, opts?: RequestOptions) => request<T>('GET', p, opts),
  post:   <T = any>(p: string, body?: any, opts?: RequestOptions) => request<T>('POST', p, { ...opts, body }),
  patch:  <T = any>(p: string, body?: any, opts?: RequestOptions) => request<T>('PATCH', p, { ...opts, body }),
  put:    <T = any>(p: string, body?: any, opts?: RequestOptions) => request<T>('PUT', p, { ...opts, body }),
  delete: <T = any>(p: string, opts?: RequestOptions) => request<T>('DELETE', p, opts),
};
