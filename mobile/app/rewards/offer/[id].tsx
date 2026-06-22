/**
 * Offer detail + redeem flow.
 *
 * If the offer needs points, we show the cost vs balance up front so
 * the user knows whether they can afford it before tapping redeem.
 * Already-redeemed offers surface the existing code instead of issuing
 * a new one (backend returns 200 with already_redeemed:true).
 */
import { useState } from 'react';
import { Alert, Image, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getOffer, getBalance, redeemOffer, type Redemption } from '@/lib/api/rewards';
import { colors, fontFamily } from '@/lib/theme/tokens';

export default function OfferDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const offerId = String(id || '');
  const qc = useQueryClient();

  const offerQ   = useQuery({ queryKey: ['offer', offerId], queryFn: () => getOffer(offerId).then(r => r.offer), enabled: !!offerId });
  const balanceQ = useQuery({ queryKey: ['balance'],        queryFn: () => getBalance() });

  const [issued, setIssued] = useState<Redemption | null>(null);

  const redeemMu = useMutation({
    mutationFn: () => redeemOffer(offerId),
    onSuccess: async (res) => {
      setIssued(res.redemption);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['balance'] }),
        qc.invalidateQueries({ queryKey: ['my-redemptions'] }),
        qc.invalidateQueries({ queryKey: ['points-history'] }),
      ]);
    },
    onError: (err) => Alert.alert('Could not redeem', (err as Error).message || 'Try again.'),
  });

  const o = offerQ.data;
  const cost     = o?.points_required || 0;
  const balance  = balanceQ.data?.balance || 0;
  const canAfford = cost === 0 || balance >= cost;

  return (
    <SafeAreaView className="flex-1 bg-atp-black" edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingBottom: 140 }}>
        <View className="px-5 pt-2 pb-3">
          <Pressable onPress={() => router.back()} className="py-2 -ml-2">
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-lg">←</Text>
          </Pressable>
        </View>

        {!!o?.image_url && (
          <Image source={{ uri: o.image_url }} style={{ width: '100%', aspectRatio: 16 / 9, backgroundColor: colors.dark2 }} resizeMode="cover" />
        )}

        <View className="px-5 mt-4">
          {!!o?.partner_name && (
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-xs uppercase tracking-widest mb-2">
              {o.partner_name}
            </Text>
          )}
          <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-3xl uppercase tracking-tight">
            {o?.title || ' '}
          </Text>
        </View>

        <View className="px-5 mt-4 flex-row gap-3 flex-wrap">
          {!!o?.discount_pct && (
            <View className="bg-atp-dark border border-white/10 rounded-atp px-3 py-1.5">
              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.warning }} className="text-xs">
                {o.discount_pct}% off
              </Text>
            </View>
          )}
          {!!cost && (
            <View className="bg-atp-dark border border-white/10 rounded-atp px-3 py-1.5">
              <Text style={{ fontFamily: fontFamily.bodyBold, color: canAfford ? colors.green : colors.danger }} className="text-xs">
                {cost.toLocaleString()} pts · you have {balance.toLocaleString()}
              </Text>
            </View>
          )}
          {!!o?.event_date && (
            <View className="bg-atp-dark border border-white/10 rounded-atp px-3 py-1.5">
              <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-xs">
                {new Date(o.event_date).toLocaleString()}
              </Text>
            </View>
          )}
          {!!o?.event_location && (
            <View className="bg-atp-dark border border-white/10 rounded-atp px-3 py-1.5">
              <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-xs">
                📍 {o.event_location}
              </Text>
            </View>
          )}
        </View>

        {!!o?.description && (
          <View className="px-5 mt-6">
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest mb-2">About</Text>
            <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-base leading-relaxed">{o.description}</Text>
          </View>
        )}

        {!!o?.terms && (
          <View className="px-5 mt-6">
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest mb-2">Terms</Text>
            <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs leading-relaxed">{o.terms}</Text>
          </View>
        )}

        {issued && (
          <View className="px-5 mt-7">
            <View className="bg-atp-green/15 border border-atp-green/50 rounded-atp-lg p-5 items-center">
              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-xs uppercase tracking-widest mb-1">
                Your code
              </Text>
              <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-2xl tracking-widest">
                {issued.code}
              </Text>
              {!!issued.expires_at && (
                <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-xs mt-2">
                  Expires {new Date(issued.expires_at).toLocaleDateString()}
                </Text>
              )}
              {!!o?.external_url && (
                <Pressable
                  onPress={() => Linking.openURL(o.external_url!)}
                  className="mt-4 bg-atp-green rounded-atp px-5 py-3 active:opacity-80"
                >
                  <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.black }} className="text-sm uppercase tracking-widest">
                    Open partner site
                  </Text>
                </Pressable>
              )}
            </View>
          </View>
        )}
      </ScrollView>

      {!issued && (
        <View className="absolute bottom-0 left-0 right-0 px-5 pb-7 pt-3 bg-atp-black border-t border-white/5">
          <Pressable
            onPress={() => {
              if (!canAfford) {
                Alert.alert('Not enough points', `You need ${(cost - balance).toLocaleString()} more points.`);
                return;
              }
              Alert.alert(
                cost > 0 ? `Spend ${cost.toLocaleString()} points?` : 'Get your code?',
                cost > 0 ? 'This will deduct points from your balance immediately.' : undefined,
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: cost > 0 ? 'Redeem' : 'Get code', onPress: () => redeemMu.mutate() },
                ]
              );
            }}
            disabled={redeemMu.isPending}
            className={`rounded-atp py-4 items-center ${redeemMu.isPending ? 'bg-atp-dark-3' : 'bg-atp-green active:opacity-80'}`}
          >
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.black }} className="text-base uppercase tracking-widest">
              {redeemMu.isPending ? 'Redeeming…' : cost > 0 ? `Redeem · ${cost.toLocaleString()} pts` : 'Get code'}
            </Text>
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}
