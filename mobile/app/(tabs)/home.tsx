/**
 * Home tab — Phase 4 will fill this in with:
 *  - Personalised greeting + streak alive badge
 *  - Next upcoming session card (1-click rebook)
 *  - Quick-access tile row: My QR · Points balance · Today's tribe activity
 *  - Recent community activity (3 latest posts from friends)
 *
 * Stub for now so the tabs render. Reads the auth store for member name.
 */
import { SafeAreaView, ScrollView, Text, View } from 'react-native';
import { useAuthStore } from '@/lib/stores/auth.store';
import { fontFamily } from '@/lib/theme/tokens';

export default function Home() {
  const member = useAuthStore((s) => s.member);
  const name = member?.first_name || 'Athlete';
  return (
    <SafeAreaView className="flex-1 bg-atp-black">
      <ScrollView contentContainerStyle={{ padding: 20 }}>
        <Text style={{ fontFamily: fontFamily.body }} className="text-atp-muted text-sm">Welcome back,</Text>
        <Text style={{ fontFamily: fontFamily.displayBlack }} className="text-atp-white text-4xl uppercase tracking-tight mt-1">
          {name}.
        </Text>
        <View className="mt-8 p-5 rounded-atp-lg bg-atp-dark border border-white/5">
          <Text style={{ fontFamily: fontFamily.bodyBold }} className="text-atp-light text-xs uppercase tracking-widest mb-2">Phase 4 placeholder</Text>
          <Text style={{ fontFamily: fontFamily.body }} className="text-atp-white text-base leading-relaxed">
            This tab fills in next: next session card, streak badge, quick-access tiles, friend activity.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
