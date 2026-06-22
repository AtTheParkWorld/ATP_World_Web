/**
 * Coach wallet — balance + pending + payout history. Read-only on
 * mobile; payout setup (bank account) stays on the web side because
 * it requires identity verification fields we don't want to collect
 * inside an Apple-reviewed app.
 */
import { ActivityIndicator, Linking, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getMyWallet } from '@/lib/api/coach';
import { colors, fontFamily } from '@/lib/theme/tokens';

export default function CoachWallet() {
  const qc = useQueryClient();
  const q  = useQuery({ queryKey: ['coach-wallet'], queryFn: () => getMyWallet() });

  return (
    <SafeAreaView className="flex-1 bg-atp-black" edges={['top']}>
      <View className="px-5 pt-2 pb-3 flex-row items-center border-b border-white/5">
        <Pressable onPress={() => router.back()} className="py-2 -ml-2 px-2">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-lg">←</Text>
        </Pressable>
        <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-lg uppercase ml-2">
          Wallet
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={
          <RefreshControl
            tintColor={colors.green}
            refreshing={q.isFetching && !q.isLoading}
            onRefresh={() => qc.invalidateQueries({ queryKey: ['coach-wallet'] })}
          />
        }
      >
        {q.isLoading ? (
          <View className="pt-12 items-center"><ActivityIndicator color={colors.green} /></View>
        ) : (
          <>
            <View className="px-5 mt-4">
              <View className="bg-atp-dark border border-white/5 rounded-atp-lg p-5">
                <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest">
                  Available
                </Text>
                <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.green }} className="text-5xl mt-1">
                  AED {(q.data?.balance_aed ?? 0).toLocaleString()}
                </Text>
                <View className="flex-row gap-3 mt-4">
                  <View className="flex-1 bg-atp-dark-3 rounded-atp p-3">
                    <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-[10px] uppercase tracking-widest">
                      Pending
                    </Text>
                    <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.warning }} className="text-lg mt-1">
                      AED {(q.data?.pending_aed ?? 0).toLocaleString()}
                    </Text>
                  </View>
                  <View className="flex-1 bg-atp-dark-3 rounded-atp p-3">
                    <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-[10px] uppercase tracking-widest">
                      Paid out (lifetime)
                    </Text>
                    <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.light }} className="text-lg mt-1">
                      AED {(q.data?.paid_out_aed ?? 0).toLocaleString()}
                    </Text>
                  </View>
                </View>
              </View>
            </View>

            <View className="px-5 mt-5">
              <Pressable
                onPress={() => Linking.openURL('https://atthepark.world/coach/wallet')}
                className="bg-atp-dark border border-white/10 rounded-atp p-4 active:opacity-70"
              >
                <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm">
                  Set up bank account →
                </Text>
                <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs mt-1">
                  Opens the web dashboard. Required for payouts.
                </Text>
              </Pressable>
            </View>

            <View className="px-5 mt-7">
              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest mb-3">
                Recent payouts
              </Text>
              {(q.data?.recent_payouts || []).length === 0 ? (
                <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm">
                  No payouts yet.
                </Text>
              ) : (
                (q.data!.recent_payouts).map((p) => (
                  <View key={p.id} className="bg-atp-dark border border-white/5 rounded-atp p-3 mb-2 flex-row items-center justify-between">
                    <View>
                      <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm">
                        AED {p.amount_aed.toLocaleString()}
                      </Text>
                      <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs mt-0.5">
                        {new Date(p.created_at).toLocaleDateString()}
                      </Text>
                    </View>
                    <Text style={{ fontFamily: fontFamily.bodyBold, color: p.status === 'paid' ? colors.green : colors.warning }} className="text-xs uppercase tracking-widest">
                      {p.status}
                    </Text>
                  </View>
                ))
              )}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
