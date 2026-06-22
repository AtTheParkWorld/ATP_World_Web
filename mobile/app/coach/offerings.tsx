/**
 * Coach offerings — what 1:1 sessions you offer to clients
 * (duration, price, max participants). Read-only view for now;
 * editing happens on the web because of the broader form fields.
 */
import { ActivityIndicator, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { listMyOfferings } from '@/lib/api/coach';
import { colors, fontFamily } from '@/lib/theme/tokens';

export default function CoachOfferings() {
  const q = useQuery({ queryKey: ['coach-offerings'], queryFn: () => listMyOfferings().then(r => r.offerings) });

  return (
    <SafeAreaView className="flex-1 bg-atp-black" edges={['top']}>
      <View className="px-5 pt-2 pb-3 flex-row items-center border-b border-white/5">
        <Pressable onPress={() => router.back()} className="py-2 -ml-2 px-2">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-lg">←</Text>
        </Pressable>
        <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-lg uppercase ml-2">
          My offerings
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        {q.isLoading ? (
          <View className="pt-12 items-center"><ActivityIndicator color={colors.green} /></View>
        ) : (
          <>
            <View className="px-5 mt-4">
              {(q.data || []).map((o) => (
                <View key={o.id} className="bg-atp-dark border border-white/5 rounded-atp p-4 mb-3">
                  <View className="flex-row items-start justify-between">
                    <View className="flex-1">
                      <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-base">
                        {o.title}
                      </Text>
                      {!!o.description && (
                        <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-sm mt-1 leading-relaxed">
                          {o.description}
                        </Text>
                      )}
                    </View>
                    {!o.is_active && (
                      <View className="bg-atp-dark-3 rounded px-2 py-0.5">
                        <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-[10px] uppercase tracking-widest">
                          Hidden
                        </Text>
                      </View>
                    )}
                  </View>
                  <View className="flex-row items-center gap-3 mt-3">
                    <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-sm">
                      AED {o.price_aed.toLocaleString()}
                    </Text>
                    <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs">
                      · {o.duration_mins} min · max {o.max_participants}
                    </Text>
                  </View>
                </View>
              ))}
              {!q.isLoading && (q.data || []).length === 0 && (
                <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm">
                  No offerings yet. Set them up on the web.
                </Text>
              )}
            </View>

            <View className="px-5 mt-5">
              <Pressable
                onPress={() => Linking.openURL('https://atthepark.world/coach/me')}
                className="bg-atp-dark border border-white/10 rounded-atp p-4 active:opacity-70"
              >
                <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm">
                  Edit on web →
                </Text>
                <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs mt-1">
                  Add or modify offerings, prices, and availability.
                </Text>
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
