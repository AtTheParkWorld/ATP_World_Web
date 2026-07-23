/**
 * Deep-link normalizer (expo-router). Runs before routing for every
 * incoming universal link / custom-scheme URL, so legacy website paths
 * resolve to the right in-app screen instead of falling to +not-found.
 *
 * The AASA (backend/public/.well-known/apple-app-site-association)
 * deliberately only claims app-native paths, but the app is also
 * reachable via the `atp://` scheme and Android autoVerify, where a
 * stray legacy path can still arrive. Map the ones we know; pass
 * everything else through unchanged.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    // path may be a full URL (atp://…, https://…) or a bare path.
    const u = path.includes('://') ? new URL(path) : new URL(path, 'https://atthepark.world');
    const p = u.pathname;
    const q = u.searchParams;

    // Legacy session link:  /sessions.html?id=123  ->  /sessions/123
    if (p === '/sessions.html' && q.get('id')) {
      return `/sessions/${encodeURIComponent(q.get('id')!)}`;
    }
    // Legacy profile link:   /profile.html          ->  profile tab
    if (p === '/profile.html' || p === '/profile') {
      return '/(tabs)/profile';
    }
    // Legacy community link:  /community.html        ->  community tab
    if (p === '/community.html' || p === '/community') {
      return '/(tabs)/community';
    }
    // Legacy store link:      /store, /store.html    ->  store tab
    if (p === '/store' || p === '/store.html') {
      return '/(tabs)/store';
    }
    // Magic-link path is claimed + already routes (app/auth/verify.tsx);
    // preserve its query string.
    if (p === '/auth/verify') {
      return `/auth/verify${u.search}`;
    }
  } catch {
    // Malformed URL — let the router try the original path.
  }
  return path;
}
