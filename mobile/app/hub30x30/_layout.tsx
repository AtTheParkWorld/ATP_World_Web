import { Stack } from 'expo-router';

// 30x30 Fitness Hub (founder 2026-10-19): hub schedule, challenges, results.
export default function Hub30Stack() {
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
