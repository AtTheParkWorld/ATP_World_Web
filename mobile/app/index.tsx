/**
 * App entry point — auth gate.
 *
 * Decides whether to send the user into the authenticated tabs or to
 * the welcome / login flow. Runs AFTER hydration completes (parent
 * _layout blocks rendering until then), so we can trust the auth
 * store reflects real persisted state.
 */
import { Redirect } from 'expo-router';
import { useAuthStore } from '@/lib/stores/auth.store';

export default function Index() {
  const accessToken = useAuthStore((s) => s.accessToken);
  if (accessToken) return <Redirect href="/(tabs)/home" />;
  return <Redirect href="/(auth)/welcome" />;
}
