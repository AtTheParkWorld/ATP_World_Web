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
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts, DMSans_400Regular, DMSans_700Bold } from '@expo-google-fonts/dm-sans';
import { BarlowCondensed_800ExtraBold, BarlowCondensed_900Black } from '@expo-google-fonts/barlow-condensed';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StripeProvider } from '@stripe/stripe-react-native';
import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';
import { StatusBar } from 'expo-status-bar';
import { useAuthStore } from '@/lib/stores/auth.store';
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

// Hold the splash on screen until we've hydrated auth + loaded fonts.
SplashScreen.preventAutoHideAsync().catch(() => {});

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

  const [fontsLoaded] = useFonts({
    DMSans_400Regular,
    DMSans_700Bold,
    BarlowCondensed_800ExtraBold,
    BarlowCondensed_900Black,
  });

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (!isHydrating && fontsLoaded) {
      SplashScreen.hideAsync().catch(() => {});
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
