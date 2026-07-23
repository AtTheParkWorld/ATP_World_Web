/**
 * Redeem points → store discount code. Backend rule: minimum 280 pts
 * (≈ AED 1), step of 28 pts per AED 0.10.
 *
 * UI: stepper + preview + confirm. On success we surface the Shopify
 * code returned by the backend so the member can copy and paste it
 * into the web store at checkout.
 */
import { useState } from 'react';
import { Alert, Pressable, ScrollView, Share, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getBalance, redeemPointsForStore } from '@/lib/api/rewards';
import { colors, fontFamily } from '@/lib/theme/tokens';

const MIN = 280;
const STEP = 28; // 28 pts = 0.10 AED
const AED_PER_STEP = 0.10;

export default function Redeem() {
  const qc = useQueryClient();
  const balanceQ = useQuery({ queryKey: ['balance'], queryFn: () => getBalance() });
  const balance = balanceQ.data?.balance || 0;

  const initial = Math.min(Math.max(MIN, 280), Math.max(MIN, balance));
  const [points, setPoints] = useState<number>(initial);
  const [code, setCode]     = useState<string | null>(null);

  const aed = (points / STEP) * AED_PER_STEP;

  const redeemMu = useMutation({
    mutationFn: () => redeemPointsForStore(points),
    onSuccess: (res) => {
      setCode(res.discount_code);
      qc.invalidateQueries({ queryKey: ['balance'] });
      qc.invalidateQueries({ queryKey: ['points-history'] });
    },
    onError: (err) => Alert.alert('Could not redeem', (err as Error).message || 'Try again.'),
  });

  function bump(delta: number) {
    const next = Math.min(balance, Math.max(MIN, points + delta));
    setPoints(next - (next % STEP));
  }

  if (code) {
    return (
      <SafeAreaView className="flex-1 bg-atp-black" edges={['top']}>
        <View className="flex-1 px-6 py-12 items-center justify-center">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-xs uppercase tracking-widest mb-3">
            Your discount code
          </Text>
          <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-4xl tracking-widest text-center">
            {code}
          </Text>
          <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-base mt-4 text-center">
            Apply at checkout in the ATP Store
          </Text>
          <Pressable
            onPress={() => Share.share({ message: `My ATP store discount code: ${code}` })}
            className="mt-8 bg-atp-green rounded-atp px-6 py-3 active:opacity-80"
          >
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.black }} className="text-base uppercase tracking-widest">
              Share / copy
            </Text>
          </Pressable>
          <Pressable onPress={() => router.back()} className="mt-3 py-3">
            <Text style={{ fontFamily: fontFamily.body, color: colors.muted }}>Done</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-atp-black" edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingBottom: 80 }}>
        <View className="px-5 pt-2 pb-3 flex-row items-center justify-between">
          <Pressable onPress={() => router.back()} className="py-2 -ml-2">
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-lg">←</Text>
          </Pressable>
          <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-lg uppercase">
            Redeem
          </Text>
          <View style={{ width: 32 }} />
        </View>

        <View className="px-5 mt-2">
          <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm">
            You have {balance.toLocaleString()} points.
          </Text>
        </View>

        <View className="px-5 mt-8 items-center">
          <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.green }} className="text-6xl">
            {points.toLocaleString()}
          </Text>
          <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm mt-1">
            pts ≈ AED {aed.toFixed(2)} off
          </Text>

          <View className="flex-row gap-3 mt-6">
            <StepperBtn label="-280"  onPress={() => bump(-280)} disabled={points <= MIN} />
            <StepperBtn label="-28"   onPress={() => bump(-28)}  disabled={points <= MIN} />
            <StepperBtn label="+28"   onPress={() => bump(+28)}  disabled={points + 28 > balance} />
            <StepperBtn label="+280"  onPress={() => bump(+280)} disabled={points + 280 > balance} />
          </View>

          <Pressable
            onPress={() => bump(balance - points)}
            className="mt-4 bg-atp-dark border border-white/10 rounded-atp px-4 py-2 active:opacity-80"
          >
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-xs uppercase tracking-widest">
              Use all ({balance.toLocaleString()})
            </Text>
          </Pressable>
        </View>

        <View className="px-5 mt-10">
          <Pressable
            onPress={() => {
              Alert.alert(
                `Redeem ${points.toLocaleString()} points?`,
                `You'll get a one-time code worth AED ${aed.toFixed(2)} to use at checkout.`,
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Redeem', onPress: () => redeemMu.mutate() },
                ]
              );
            }}
            disabled={redeemMu.isPending || points < MIN || points > balance}
            className={`rounded-atp py-4 items-center ${(redeemMu.isPending || points < MIN || points > balance) ? 'bg-atp-dark-3' : 'bg-atp-green active:opacity-80'}`}
          >
            <Text
              style={{
                fontFamily: fontFamily.bodyBold,
                color: (redeemMu.isPending || points < MIN || points > balance) ? colors.muted : colors.black,
              }}
              className="text-base uppercase tracking-widest"
            >
              {redeemMu.isPending ? 'Redeeming…' : `Redeem ${points.toLocaleString()} pts`}
            </Text>
          </Pressable>
          <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs mt-2 text-center">
            Code is single-use and tied to your account.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function StepperBtn({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className={`rounded-atp px-4 py-3 ${disabled ? 'bg-atp-dark border border-white/5' : 'bg-atp-dark border border-white/15 active:opacity-80'}`}
    >
      <Text
        style={{ fontFamily: fontFamily.bodyBold, color: disabled ? colors.muted : colors.white }}
        className="text-xs"
      >
        {label}
      </Text>
    </Pressable>
  );
}
