/**
 * Root layout — runs on every screen, mounts every global provider.
 *
 * Responsibilities:
 *  - Hydrate auth from secure storage BEFORE any child renders
 *  - Mount QueryClientProvider for react-query
 *  - Mount StripeProvider for Apple Pay / Google Pay
 *  - Init Sentry crash reporting
 *  - Init OneSignal push (idempotent — safe to call on every reload)
 *  - Init Amplitude analytics
 *  - Splash screen control — hide once auth has hydrated + fonts loaded
 *
 * Auth gate: when accessToken is missing, child routes redirect to
 * (auth)/welcome via the index.tsx route guard. We DON'T redirect from
 * here so that deep links to (auth)/* screens still resolve cleanly.
 */
import 'react-native-gesture-handler';
import { useEffect } from 'react';
import { Stack, router } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts, DMSans_400Regular, DMSans_700Bold } from '@expo-google-fonts/dm-sans';
import { BarlowCondensed_800ExtraBold, BarlowCondensed_900Black } from '@expo-google-fonts/barlow-condensed';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StripeProvider } from '@stripe/stripe-react-native';
import * as Sentry from '@sentry/react-native';
import * as Updates from 'expo-updates';
import { AppState } from 'react-native';
import Constants from 'expo-constants';
import { StatusBar } from 'expo-status-bar';
import { useAuthStore } from '@/lib/stores/auth.store';
import { RouteErrorBoundary } from '@/lib/components/RouteErrorBoundary';
import '../global.css';

const extra = (Constants.expoConfig?.extra || {}) as Record<string, string>;

// Sentry init — runs on the first import, BEFORE app renders, so we
// catch boot-time crashes too. DSN comes from app.json extra; if it's
// empty (dev) Sentry no-ops.
Sentry.init({
  dsn: extra.sentryDsn || undefined,
  environment: __DEV__ ? 'development' : 'production',
  tracesSampleRate: __DEV__ ? 1.0 : 0.2,
  enableNative: !__DEV__,
});

// OneSignal push init — the plugin + app id were configured from day
// one but nothing ever called initialize(), so push was a silent no-op.
// Guarded: no-ops in dev/simulator or when the id is missing.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let oneSignal: any = null;

// Where a tapped notification should land. The server puts the target in
// the push's data (stream_id / post_id / session_id); anything else opens
// the inbox. Pushes used to carry a web URL that OneSignal opened in the
// BROWSER, where the member usually isn't signed in.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function routeForPush(data: any): string | null {
  if (!data || typeof data !== 'object') return '/inbox';
  const id = (v: unknown) => encodeURIComponent(String(v));
  if (data.stream_id) return `/live/${id(data.stream_id)}`;
  if (data.post_id) return `/community/post/${id(data.post_id)}`;
  if (data.session_id) return `/sessions/${id(data.session_id)}`;
  if (data.kind === 'test') return null;
  return '/inbox';
}

// A tap on a cold start arrives before the navigator exists; park it
// until the root layout has mounted.
let navReady = false;
let pendingRoute: string | null = null;
function openRoute(route: string) {
  if (navReady) router.push(route as never);
  else pendingRoute = route;
}

try {
  if (extra.oneSignalAppId) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { OneSignal, LogLevel } = require('react-native-onesignal');
    OneSignal.Debug.setLogLevel(__DEV__ ? LogLevel.Verbose : LogLevel.None);
    OneSignal.initialize(extra.oneSignalAppId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    OneSignal.Notifications.addEventListener('click', (event: any) => {
      const route = routeForPush(event?.notification?.additionalData);
      if (route) openRoute(route);
    });
    oneSignal = OneSignal;
  }
} catch (e) {
  // Native module absent (Expo Go) — push simply stays off.
}

// Hold the splash on screen until we've hydrated auth + loaded fonts.
SplashScreen.preventAutoHideAsync().catch(() => {});

/**
 * OTA updates — apply on the SAME launch, not the next one.
 *
 * expo-updates' default is fire-and-forget: it downloads a new update
 * in the background and only swaps it in on the following cold start.
 * That means a tester who opens the app right after we publish sees
 * the OLD screens and has to quit + reopen a second time before the
 * change appears (founder hit exactly this, 2026-08-07).
 *
 * Instead we check explicitly, and if an update is waiting we reload
 * into it while the splash is still up — the user just sees a slightly
 * longer splash, then the new version. Failures are swallowed: an
 * offline or unreachable update server must never block app start.
 */
async function applyPendingUpdate(): Promise<void> {
  // Updates are baked in at build time; in dev / Expo Go there is no
  // update channel and isEnabled is false.
  if (__DEV__ || !Updates.isEnabled) return;
  try {
    // Hard cap the network work. A member on hotel wifi must never
    // stare at the splash because our update server is slow — if the
    // check/fetch outruns the budget we boot the cached version and
    // the download (still running) lands on the next launch.
    const budget = new Promise<'timeout'>((resolve) =>
      setTimeout(() => resolve('timeout'), 6000)
    );
    const work = (async () => {
      const { isAvailable } = await Updates.checkForUpdateAsync();
      if (!isAvailable) return 'none' as const;
      await Updates.fetchUpdateAsync();
      return 'ready' as const;
    })();

    if ((await Promise.race([work, budget])) === 'ready') {
      await Updates.reloadAsync();  // never returns — app restarts
    }
  } catch {
    // Offline, server down, or no matching runtime → carry on with
    // whatever version is already installed.
  }
}

// App-wide safety net: a screen error shows a readable page with the
// message instead of the app vanishing (founder 2026-09-19).
export function ErrorBoundary(props: { error: Error; retry: () => void }) {
  return <RouteErrorBoundary {...props} />;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // ATP data is fairly fresh (rolling sessions, points balance,
      // notifications). 30s staleTime balances bandwidth + freshness.
      staleTime: 30 * 1000,
      refetchOnWindowFocus: true,
      retry: 1,
    },
  },
});

function RootLayoutInner() {
  const hydrate = useAuthStore((s) => s.hydrate);
  const isHydrating = useAuthStore((s) => s.isHydrating);
  const memberId = useAuthStore((s) => s.member?.id);

  const [fontsLoaded] = useFonts({
    DMSans_400Regular,
    DMSans_700Bold,
    BarlowCondensed_800ExtraBold,
    BarlowCondensed_900Black,
  });

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  // Pull any published update on cold start (splash is still up, so a
  // reload here is invisible), then again whenever the app returns to
  // the foreground after being backgrounded — a phone that never gets
  // fully quit would otherwise sit on an old version indefinitely.
  useEffect(() => {
    applyPendingUpdate();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') applyPendingUpdate();
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!isHydrating && fontsLoaded) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [isHydrating, fontsLoaded]);

  // Tie this phone to the signed-in member. The server sends every push
  // to the member id (OneSignal external_id); without this login no push
  // could ever find a device. Signing out unlinks the phone so the next
  // person on it doesn't receive the previous member's notifications.
  useEffect(() => {
    if (isHydrating || !oneSignal) return;
    try {
      if (memberId) oneSignal.login(String(memberId));
      else oneSignal.logout();
    } catch {
      // Never let push wiring break the app.
    }
  }, [memberId, isHydrating]);

  // The navigator is up once the Stack renders; deliver any tap that
  // arrived during a cold start.
  useEffect(() => {
    if (isHydrating || !fontsLoaded) return;
    navReady = true;
    if (pendingRoute) {
      const route = pendingRoute;
      pendingRoute = null;
      setTimeout(() => router.push(route as never), 300);
    }
  }, [isHydrating, fontsLoaded]);

  // Render nothing until both hydrate + fonts are ready. The native
  // splash stays visible (preventAutoHideAsync above) so no flash.
  if (isHydrating || !fontsLoaded) return null;

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#0a0a0a' },
          animation: 'slide_from_right',
        }}
      />
    </>
  );
}

function Root() {
  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <StripeProvider publishableKey={extra.stripePublishableKey || ''}>
          <RootLayoutInner />
        </StripeProvider>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}

export default Sentry.wrap(Root);
