import { SafeAreaView, Text, View } from 'react-native';
import { fontFamily } from '@/lib/theme/tokens';
// Phase 6 fills in: points balance + history + redeem + partner offers +
// wallet (ATP credit + welcome discount code).
export default function Rewards() {
  return (
    <SafeAreaView className="flex-1 bg-atp-black">
      <View className="p-5">
        <Text style={{ fontFamily: fontFamily.displayBlack }} className="text-atp-white text-3xl uppercase">Rewards</Text>
        <Text style={{ fontFamily: fontFamily.body }} className="text-atp-light mt-3">Phase 6 — points, wallet, offers, redemption.</Text>
      </View>
    </SafeAreaView>
  );
}
