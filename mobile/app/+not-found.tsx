/**
 * Catch-all for deep links the app has no route for (e.g. AASA claims
 * like /coach/:slug or /sessions.html that only exist on the website).
 * Without this, expo-router shows its developer "Unmatched Route"
 * screen to real members. We send them to Home instead.
 */
import { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { colors } from '@/lib/theme/tokens';

export default function NotFound() {
  useEffect(() => {
    const t = setTimeout(() => router.replace('/(tabs)/home'), 50);
    return () => clearTimeout(t);
  }, []);
  return (
    <View className="flex-1 bg-atp-black items-center justify-center">
      <ActivityIndicator color={colors.green} />
    </View>
  );
}
