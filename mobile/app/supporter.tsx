/**
 * Be a Supporter — subscription tier picker.
 *
 * Three tiers from the backend: Free / Premium / Premium Plus.
 * Tap a paid tier → Stripe Checkout opens via expo-web-browser. On
 * success the browser closes via our atp:// custom scheme; we then
 * refetch the subscription so the active badge appears immediately.
 *
 * Members with an active sub see a "Manage" button instead of the
 * tier picker — that opens the Stripe customer portal.
 *
 * iOS (App Store 3.1.1): no purchase flow, no prices, no external
 * links. Tiers render read-only (perks only) and a neutral line points
 * at "the ATP website" without linking. Existing supporters still see
 * their status. Android keeps the full Stripe flow.
 */
import { Alert, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as WebBrowser from 'expo-web-browser';
import { listPlans, getMySubscription, createCheckout, openPortal, type SubscriptionPlan } from '@/lib/api/billing';
import { useAuthStore } from '@/lib/stores/auth.store';
import { colors, fontFamily } from '@/lib/theme/tokens';

// Apple guideline 3.1.1 — digital-content subscriptions can't be sold
// via external checkout on iOS, and steering language gets flagged.
const IS_IOS = Platform.OS === 'ios';

export default function Supporter() {
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.member) as any;

  const plansQ = useQuery({
    queryKey: ['plans'],
    queryFn:  () => listPlans('AE').then(r => r.plans),
    staleTime: 1000 * 60 * 10,
  });
  const subQ = useQuery({
    queryKey: ['my-subscription'],
    queryFn:  () => getMySubscription().then(r => r.subscription),
  });

  const subscription = subQ.data;
  const activeTier   = subscription && ['active', 'trialing'].includes(subscription.status)
    ? subscription.plan_id
    : null;

  async function startCheckout(plan: SubscriptionPlan) {
    try {
      const { url } = await createCheckout(plan.id, 'month');
      // Open in-app browser; iOS shows a "Done" button that returns to the app.
      const result = await WebBrowser.openAuthSessionAsync(url, 'atp://billing/success');
      // result.type = 'success' | 'cancel' | 'dismiss'
      // Always refetch — even on cancel the user might have completed and we just
      // didn't catch the redirect (e.g. they hit Done instead of completing).
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['my-subscription'] }),
        qc.invalidateQueries({ queryKey: ['profile'] }),
      ]);
      if (result.type === 'success' || result.type === 'dismiss') {
        Alert.alert('Welcome to ' + plan.name, 'Your supporter perks are active.');
      }
    } catch (err: any) {
      if (err?.code === 'STRIPE_NOT_CONFIGURED') {
        Alert.alert('Coming soon', 'Subscriptions launch in beta soon. We\'ll text you when.');
      } else {
        Alert.alert('Could not start checkout', err?.message || 'Try again.');
      }
    }
  }

  async function manage() {
    try {
      const { url } = await openPortal();
      await WebBrowser.openAuthSessionAsync(url, 'atp://billing/return');
      qc.invalidateQueries({ queryKey: ['my-subscription'] });
    } catch (err: any) {
      Alert.alert('Could not open billing portal', err?.message || 'Try again.');
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-atp-black" edges={['top']}>
      <View className="px-5 pt-2 pb-3 flex-row items-center border-b border-white/5">
        <Pressable onPress={() => router.back()} className="py-2 -ml-2 px-2">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-lg">←</Text>
        </Pressable>
        <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-lg uppercase ml-2">
          Be a supporter
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
        <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-4xl uppercase tracking-tight">
          Power{'\n'}the park.
        </Text>
        <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-base mt-3 leading-relaxed">
          Free outdoor fitness is our default for everyone — supporters keep it that way and unlock extras for themselves: tribe-only sessions, live streams, exclusive offers.
        </Text>

        {subscription && activeTier && (
          <View className="bg-atp-green/10 border border-atp-green/40 rounded-atp p-4 mt-5">
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-xs uppercase tracking-widest mb-1">
              You are a {subscription.plan_name} supporter
            </Text>
            <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-sm">
              Next renewal: {new Date(subscription.current_period_end).toLocaleDateString()}
              {subscription.cancel_at_period_end ? ' · cancelling at period end' : ''}
            </Text>
            {!IS_IOS && (
              <Pressable
                onPress={manage}
                className="mt-3 bg-atp-dark border border-white/10 rounded-atp py-2.5 items-center active:opacity-80"
              >
                <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm uppercase tracking-widest">
                  Manage subscription
                </Text>
              </Pressable>
            )}
          </View>
        )}

        <View className="mt-7 gap-3">
          {(plansQ.data || []).map((p) => (
            <PlanCard
              key={p.id}
              plan={p}
              active={activeTier === p.id}
              readOnly={IS_IOS}
              onPress={() => startCheckout(p)}
            />
          ))}
        </View>

        {IS_IOS ? (
          <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs mt-7 text-center leading-relaxed">
            Supporter management is available on the ATP website.
          </Text>
        ) : (
          <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs mt-7 text-center leading-relaxed">
            Payments are handled securely by Stripe. Cancel any time — you keep access until the end of your billing period.
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function PlanCard({ plan, active, readOnly, onPress }: { plan: SubscriptionPlan; active: boolean; readOnly?: boolean; onPress: () => void }) {
  const price = plan.amount_cents > 0 ? (plan.amount_cents / 100).toFixed(0) : '0';
  const isPlus = plan.tier === 'premium_plus';
  return (
    <Pressable
      onPress={onPress}
      disabled={readOnly || active || !plan.purchasable}
      className={`rounded-atp-lg p-5 border ${active ? 'bg-atp-green/15 border-atp-green' : isPlus ? 'bg-atp-dark border-atp-green/40' : 'bg-atp-dark border-white/10'} active:opacity-80`}
    >
      <View className="flex-row items-start justify-between">
        <View className="flex-1">
          <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-2xl uppercase">
            {plan.name}
          </Text>
          {!!plan.tagline && (
            <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-sm mt-1">
              {plan.tagline}
            </Text>
          )}
        </View>
        {/* No prices on iOS — Apple reads them as steering to external purchase. */}
        {!readOnly && (
          <View className="items-end">
            <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.green }} className="text-3xl">
              {plan.currency} {price}
            </Text>
            <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs">
              /{plan.interval}
            </Text>
          </View>
        )}
      </View>

      {!!plan.features && plan.features.length > 0 && (
        <View className="mt-4 gap-1">
          {plan.features.map((f, i) => (
            <View key={i} className="flex-row items-start gap-2">
              <Text style={{ color: colors.green }} className="text-sm">✓</Text>
              <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-sm flex-1">
                {f}
              </Text>
            </View>
          ))}
        </View>
      )}

      {active ? (
        <View className="mt-4 bg-atp-green rounded-atp py-2.5 items-center">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.black }} className="text-xs uppercase tracking-widest">
            ✓ Active
          </Text>
        </View>
      ) : readOnly ? null : plan.amount_cents === 0 ? (
        <View className="mt-4 bg-atp-dark-3 rounded-atp py-2.5 items-center">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest">
            Free tier · default
          </Text>
        </View>
      ) : !plan.purchasable ? (
        <View className="mt-4 bg-atp-dark-3 rounded-atp py-2.5 items-center">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.warning }} className="text-xs uppercase tracking-widest">
            Coming soon
          </Text>
        </View>
      ) : (
        <View className={`mt-4 rounded-atp py-3 items-center ${isPlus ? 'bg-atp-green' : 'bg-atp-dark-3'}`}>
          <Text
            style={{ fontFamily: fontFamily.bodyBold, color: isPlus ? colors.black : colors.white }}
            className="text-sm uppercase tracking-widest"
          >
            Become {plan.name}
          </Text>
        </View>
      )}
    </Pressable>
  );
}
