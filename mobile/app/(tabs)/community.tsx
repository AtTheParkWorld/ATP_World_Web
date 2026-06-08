import { SafeAreaView, Text, View } from 'react-native';
import { fontFamily } from '@/lib/theme/tokens';
// Phase 5 fills in: Feed / Your Tribe / Leaderboard tabs + Compose FAB
// + Likes + Comments + Report + Block + Friends.
export default function Community() {
  return (
    <SafeAreaView className="flex-1 bg-atp-black">
      <View className="p-5">
        <Text style={{ fontFamily: fontFamily.displayBlack }} className="text-atp-white text-3xl uppercase">Community</Text>
        <Text style={{ fontFamily: fontFamily.body }} className="text-atp-light mt-3">Phase 5 — feed, tribe view, leaderboard.</Text>
      </View>
    </SafeAreaView>
  );
}
