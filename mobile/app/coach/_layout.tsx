import { Stack } from 'expo-router';
import { RouteErrorBoundary } from '@/lib/components/RouteErrorBoundary';

// Expo Router renders this instead of killing the app when a coach
// screen throws (founder 2026-09-19).
export function ErrorBoundary(props: { error: Error; retry: () => void }) {
  return <RouteErrorBoundary {...props} />;
}

export default function CoachStack() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#0a0a0a' },
        animation: 'slide_from_right',
      }}
    />
  );
}
