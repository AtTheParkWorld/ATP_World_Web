import { SafeAreaView, Text, View } from 'react-native';
import { fontFamily } from '@/lib/theme/tokens';
// Phase 4 fills in: list + city/activity/tribe/day filters + booking
// deep-link → /sessions/[id]. Reuses GET /api/sessions.
export default function Sessions() {
  return (
    <SafeAreaView className="flex-1 bg-atp-black">
      <View className="p-5">
        <Text style={{ fontFamily: fontFamily.displayBlack }} className="text-atp-white text-3xl uppercase">Sessions</Text>
        <Text style={{ fontFamily: fontFamily.body }} className="text-atp-light mt-3">Phase 4 — list, filters, booking flow.</Text>
      </View>
    </SafeAreaView>
  );
}
