/**
 * My orders — every ATP Store (Shopify) order the member has placed,
 * newest first, with a status chip, the items, the total and a Track
 * button (carrier page when shipped, else Shopify's order-status page).
 *
 * Founder items 7 + 8 (2026-10-06): "Members should be able to track
 * their online orders" / "track all their past apparel buys on their
 * profile".
 *
 * Orders are matched server-side on the member's VERIFIED email, so an
 * unverified account gets a one-tap "verify" step instead of a list.
 *
 * Entry points: Profile tab → "My orders"; Store tab thank-you sheet →
 * "Track your order".
 */
import { useState } from 'react';
import { Alert, FlatList, Image, Linking, Pressable, RefreshControl, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getMyOrders, formatMoney, type ShopOrder } from '@/lib/api/store';
import { requestMagicLink } from '@/lib/api/auth';
import { useAuthStore } from '@/lib/stores/auth.store';
import { LoadError } from '@/lib/components/LoadError';
import { Icon } from '@/lib/components/icons';
import { colors, fontFamily } from '@/lib/theme/tokens';

function statusColor(status: string): string {
  if (status === 'delivered') return colors.green;
  if (status === 'shipped')   return colors.info;
  if (status === 'processing' || status === 'pending_payment') return colors.warning;
  return colors.muted;   // cancelled / refunded
}

async function openLink(url: string) {
  try {
    await WebBrowser.openBrowserAsync(url, {
      presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
      dismissButtonStyle: 'close',
      toolbarColor: colors.black,
      controlsColor: colors.green,
    });
  } catch {
    Linking.openURL(url).catch(() => {});
  }
}

function orderDate(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function MyOrders() {
  const qc = useQueryClient();
  const email = useAuthStore((s) => s.member?.email);
  const [sending, setSending] = useState(false);

  const ordersQ = useQuery({
    queryKey: ['my-orders'],
    queryFn:  () => getMyOrders(),
  });

  const orders = ordersQ.data?.orders || [];
  const reason = ordersQ.data?.reason ?? null;

  const sendVerify = async () => {
    if (!email || sending) return;
    setSending(true);
    try {
      await requestMagicLink(email);
      Alert.alert('Check your inbox', `We sent a one-tap link to ${email}. Open it on this phone and your orders will appear here.`);
    } catch (e: any) {
      Alert.alert('Could not send the link', e?.message || 'Try again in a minute.');
    } finally {
      setSending(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-atp-black" edges={['top']}>
      <View className="px-5 pt-2 pb-3 flex-row items-center border-b border-white/5">
        <Pressable onPress={() => router.back()} className="py-2 -ml-2 px-2">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-lg">←</Text>
        </Pressable>
        <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-lg uppercase ml-2">
          My orders
        </Text>
      </View>

      {ordersQ.isError && !orders.length ? (
        <View className="px-5 pt-6">
          <LoadError onRetry={() => ordersQ.refetch()} />
        </View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(o) => o.id}
          renderItem={({ item }) => <OrderCard order={item} />}
          contentContainerStyle={{ paddingTop: 16, paddingBottom: 60 }}
          refreshControl={
            <RefreshControl
              tintColor={colors.green}
              refreshing={ordersQ.isFetching && !ordersQ.isLoading}
              onRefresh={() => qc.invalidateQueries({ queryKey: ['my-orders'] })}
            />
          }
          ListEmptyComponent={
            ordersQ.isLoading ? (
              <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="px-8 pt-12 text-sm text-center">
                Loading your orders…
              </Text>
            ) : reason === 'email_unverified' || reason === 'no_email' ? (
              <EmptyState
                title="Verify your email."
                body={reason === 'no_email'
                  ? 'Add an email to your profile — orders are matched to the email you use at checkout.'
                  : 'For your privacy we only show orders once your email is confirmed. One tap and you’re in.'}
                cta={reason === 'no_email' ? 'Edit profile' : (sending ? 'Sending…' : 'Send verification link')}
                onCta={reason === 'no_email' ? () => router.push('/profile/edit') : sendVerify}
              />
            ) : reason === 'not_configured' || reason === 'shopify_unavailable' ? (
              <EmptyState
                title="Almost there."
                body="Order tracking is still being connected. Meanwhile your receipts and tracking live in your ATP Store account."
                cta="Open store account"
                onCta={() => openLink(ordersQ.data!.account_orders_url)}
              />
            ) : (
              <EmptyState
                title="No orders yet."
                body="Gear up for your next session — everything you buy in the ATP Store shows up here with live tracking."
                cta="Visit the store"
                onCta={() => router.push('/(tabs)/store')}
              />
            )
          }
        />
      )}
    </SafeAreaView>
  );
}

function EmptyState({ title, body, cta, onCta }: { title: string; body: string; cta: string; onCta: () => void }) {
  return (
    <View className="px-8 pt-16 items-center">
      <View style={{ width: 56, height: 56, borderRadius: 28 }} className="bg-white/5 items-center justify-center">
        <Icon name="bag" size={26} color={colors.green} />
      </View>
      <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-2xl uppercase text-center mt-5">
        {title}
      </Text>
      <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm mt-2 text-center leading-relaxed">
        {body}
      </Text>
      <Pressable onPress={onCta} className="mt-6 bg-atp-green rounded-atp px-6 py-3.5 active:opacity-80">
        <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.black }} className="text-sm uppercase tracking-widest">
          {cta}
        </Text>
      </Pressable>
    </View>
  );
}

function OrderCard({ order }: { order: ShopOrder }) {
  const o = order;
  const color = statusColor(o.status);
  const tracking = o.tracking.find((t) => t.number || t.company);
  const canTrack = !!o.track_url && o.status !== 'cancelled' && o.status !== 'refunded';
  return (
    <View className="mx-5 mb-3 bg-atp-dark border border-white/5 rounded-atp-lg p-4">
      <View className="flex-row items-start justify-between">
        <View>
          <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-lg">
            {o.number}
          </Text>
          <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs mt-0.5">
            {orderDate(o.created_at)}
          </Text>
        </View>
        <View
          className="rounded-full px-2.5 py-1"
          style={{ borderWidth: 1, borderColor: `${color}55`, backgroundColor: `${color}15` }}
        >
          <Text style={{ fontFamily: fontFamily.bodyBold, color, letterSpacing: 1 }} className="text-[10px] uppercase">
            {o.status_label}
          </Text>
        </View>
      </View>

      {o.items.map((it, i) => (
        <View key={i} className="flex-row items-center mt-3">
          {it.image_url ? (
            <Image source={{ uri: it.image_url }} style={{ width: 44, height: 44, borderRadius: 8, backgroundColor: colors.dark2 }} />
          ) : (
            <View style={{ width: 44, height: 44, borderRadius: 8 }} className="bg-atp-dark-3 items-center justify-center">
              <Icon name="bag" size={18} color={colors.muted} />
            </View>
          )}
          <View className="flex-1 ml-3">
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm" numberOfLines={1}>
              {it.title}
            </Text>
            <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs mt-0.5">
              {[it.variant, `Qty ${it.quantity}`].filter(Boolean).join(' · ')}
            </Text>
          </View>
        </View>
      ))}

      {!!tracking && (
        <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-xs mt-3">
          {[tracking.company, tracking.number].filter(Boolean).join(' · ')}
        </Text>
      )}

      <View className="flex-row items-center justify-between mt-4 pt-3 border-t border-white/5">
        <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-base">
          {formatMoney(o.total, o.currency)}
        </Text>
        <View className="flex-row gap-2">
          {!!o.order_status_url && (
            <Pressable
              onPress={() => openLink(o.order_status_url!)}
              className="border border-white/15 rounded-atp px-3 py-2 active:opacity-70"
            >
              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-xs uppercase tracking-widest">
                Details
              </Text>
            </Pressable>
          )}
          {canTrack && (
            <Pressable onPress={() => openLink(o.track_url!)} className="bg-atp-green rounded-atp px-4 py-2 active:opacity-80">
              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.black }} className="text-xs uppercase tracking-widest">
                Track
              </Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}
