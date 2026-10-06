/**
 * Store tab — the ATP shop lives INSIDE the app now.
 *
 * Two segments:
 *   Shop    → shop.atthepark.world embedded in a WebView (members never
 *             leave the app; checkout is Shopify's mobile web checkout,
 *             fine for physical goods per App Store 3.1.3(e)).
 *   Rewards → the member's discount codes + wishlist (native UI, from
 *             the points-redemption + wishlist APIs).
 *
 * The WebView keeps its state when you switch segments (it's hidden,
 * not unmounted) so a cart in progress survives a peek at your codes.
 *
 * Checkout (founder items 4 + 6, 2026-10-06):
 *   - the member's email (+ E.164 phone) is put on the Shopify cart, so
 *     checkout opens already filled in — see lib/utils/shopCheckout;
 *   - payment stays inside this WebView (iframes and payment hops used
 *     to be bounced to Safari, which is where the "sign in on the Shopify
 *     website" and the stale Express-checkout page came from);
 *   - once Shopify confirms the order we show our own thank-you sheet
 *     and reset the shop to a fresh, empty-cart home page.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, BackHandler, Image, Linking, Platform, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewNavigation } from 'react-native-webview';
import { router, useFocusEffect } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getWishlist, getRedemptionHistory, removeFromWishlist, getMyOrders, type ShopOrder } from '@/lib/api/store';
import { OrderThankYou } from '@/lib/components/OrderThankYou';
import { useAuthStore } from '@/lib/stores/auth.store';
import { buyerIdentityScript, isCheckoutUrl, isOrderCompleteUrl, isShopifyHost } from '@/lib/utils/shopCheckout';
import { colors, fontFamily } from '@/lib/theme/tokens';

// The custom shop.atthepark.world domain has no DNS record (yet) —
// the store lives on the Shopify-issued domain. Swap back when the
// custom domain is wired up in Shopify → Settings → Domains.
const SHOP_URL = 'https://atp-store-7903.myshopify.com';
const SHOP_HOST = new URL(SHOP_URL).hostname;

type Segment = 'shop' | 'rewards';

/** The order this checkout produced: newest one placed since it began
 *  (2 min of slack for clock drift between phone and Shopify). */
function newOrderSince(orders: ShopOrder[], since: number): ShopOrder | null {
  const o = orders[0];
  if (!o || o.status === 'cancelled') return null;
  return new Date(o.created_at).getTime() >= since - 2 * 60 * 1000 ? o : null;
}

export default function StoreHub() {
  const qc = useQueryClient();
  const webRef = useRef<WebView>(null);
  const [segment, setSegment]   = useState<Segment>('shop');
  const [loading, setLoading]   = useState(true);
  const [failed, setFailed]     = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const member = useAuthStore((s) => s.member);

  // Checkout tracking. checkoutStartedAt = first checkout page seen this
  // round; inCheckout = the WebView is somewhere in checkout or a payment
  // hop it started (bank 3-D Secure, PayPal…). webKey remounts the
  // WebView after an order so its history no longer leads back into the
  // spent checkout.
  const checkoutStartedAt = useRef<number | null>(null);
  const inCheckout = useRef(false);
  const completionHandled = useRef(false);
  const lastOrderCheck = useRef(0);
  const [webKey, setWebKey] = useState(0);
  const [thanks, setThanks] = useState<{ visible: boolean; loading: boolean; order: ShopOrder | null }>(
    { visible: false, loading: false, order: null }
  );

  const prefillScript = useMemo(
    () => (member?.email ? buyerIdentityScript({ shopHost: SHOP_HOST, email: member.email, phone: member.phone }) : undefined),
    [member?.email, member?.phone]
  );

  /** Show the thank-you sheet once per order. With `found` (order seen
   *  on return to the app) it is shown straight away; otherwise we ask
   *  the backend for the new order — it can trail payment by a few
   *  seconds, hence the retries (the API serves ?fresh=1 at most every 5s). */
  const onOrderComplete = useCallback(async (found?: ShopOrder) => {
    if (completionHandled.current) return;
    completionHandled.current = true;
    const since = checkoutStartedAt.current ?? Date.now() - 30 * 60 * 1000;
    checkoutStartedAt.current = null;
    inCheckout.current = false;
    qc.invalidateQueries({ queryKey: ['my-orders'] });
    if (found) { setThanks({ visible: true, loading: false, order: found }); return; }
    setThanks({ visible: true, loading: true, order: null });
    for (const wait of [0, 6000, 12000]) {
      if (wait) await new Promise((r) => setTimeout(r, wait));
      try {
        const o = newOrderSince((await getMyOrders({ fresh: true })).orders, since);
        if (o) { setThanks((t) => ({ ...t, loading: false, order: o })); return; }
      } catch { /* keep trying — the sheet already confirms the purchase */ }
    }
    setThanks((t) => ({ ...t, loading: false }));
  }, [qc]);

  /** Paid somewhere we could not watch (bank-app approval, a wallet
   *  hand-off, an older build that bounced to Safari)? When the member
   *  comes back, look for an order placed since checkout began. */
  const checkForPlacedOrder = useCallback(() => {
    const since = checkoutStartedAt.current;
    if (!since || completionHandled.current) return;
    if (Date.now() - lastOrderCheck.current < 10000) return;
    lastOrderCheck.current = Date.now();
    getMyOrders({ fresh: true })
      .then((r) => { const o = newOrderSince(r.orders, since); if (o) onOrderComplete(o); })
      .catch(() => {});
  }, [onOrderComplete]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') checkForPlacedOrder(); });
    return () => sub.remove();
  }, [checkForPlacedOrder]);
  useFocusEffect(useCallback(() => { checkForPlacedOrder(); }, [checkForPlacedOrder]));

  const onNavChange = (nav: WebViewNavigation) => {
    setCanGoBack(nav.canGoBack);
    const url = nav.url || '';
    // A bare order-status page outside a checkout round is just the
    // member looking at an old order in their Shopify account.
    if (isOrderCompleteUrl(url) && (checkoutStartedAt.current || /thank[-_]you/i.test(url))) {
      onOrderComplete();
      return;
    }
    if (isCheckoutUrl(url)) {
      inCheckout.current = true;
      if (!checkoutStartedAt.current) checkoutStartedAt.current = Date.now();
    } else if (url.includes(SHOP_HOST)) {
      // Back on a shop page: this checkout round is over without an order.
      inCheckout.current = false;
      checkoutStartedAt.current = null;
    }
  };

  const closeThanks = (next?: () => void) => {
    setThanks({ visible: false, loading: false, order: null });
    completionHandled.current = false;
    setCanGoBack(false);
    setLoading(true);
    setWebKey((k) => k + 1);   // fresh shop home, empty cart, no way "back" into checkout
    next?.();
  };

  // Founder report 13 (2026-10-03): "the back button also causes the app
  // to crash". Nothing registered Android's hardware back button, so it
  // popped the whole screen while the WebView was mid-navigation instead
  // of stepping back inside the shop. Now it walks the WebView's own
  // history first and only leaves the tab once there is nowhere to go.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (segment === 'shop' && canGoBack) { webRef.current?.goBack(); return true; }
      if (segment === 'rewards') { setSegment('shop'); return true; }
      return false;
    });
    return () => sub.remove();
  }, [segment, canGoBack]);

  const wishlistQ = useQuery({ queryKey: ['wishlist'], queryFn: () => getWishlist().then(r => r.items) });
  const redempQ   = useQuery({ queryKey: ['store-redemptions'], queryFn: () => getRedemptionHistory().then(r => r.redemptions) });

  const activeCodes = (redempQ.data || []).filter((r) => r.status === 'issued');
  const wishlist    = wishlistQ.data || [];

  const openInShop = (path: string) => {
    setSegment('shop');
    webRef.current?.injectJavaScript(
      `window.location.href = ${JSON.stringify(SHOP_URL + path)}; true;`
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-atp-black" edges={['top']}>
      {/* Header + segmented control */}
      <View className="px-5 pt-2 pb-3 border-b border-white/5">
        <View className="flex-row items-center justify-between">
          <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-2xl uppercase tracking-tight">
            ATP Store
          </Text>
          {segment === 'shop' && canGoBack && (
            <Pressable onPress={() => webRef.current?.goBack()} className="px-3 py-1.5 rounded-atp bg-atp-dark border border-white/10 active:opacity-70">
              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-xs">← Back</Text>
            </Pressable>
          )}
        </View>
        <View className="flex-row mt-3 bg-atp-dark rounded-atp p-1 border border-white/5">
          {(['shop', 'rewards'] as Segment[]).map((s) => (
            <Pressable
              key={s}
              onPress={() => setSegment(s)}
              className={`flex-1 py-2 rounded-[6px] items-center ${segment === s ? 'bg-atp-green' : ''}`}
            >
              <Text
                style={{ fontFamily: fontFamily.bodyBold, color: segment === s ? colors.black : colors.muted, letterSpacing: 1 }}
                className="text-xs uppercase"
              >
                {s === 'shop' ? 'Shop' : `My rewards${activeCodes.length ? ` (${activeCodes.length})` : ''}`}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* SHOP — WebView kept mounted so cart state survives segment switches */}
      <View style={{ flex: 1, display: segment === 'shop' ? 'flex' : 'none' }}>
        {failed ? (
          <View className="flex-1 items-center justify-center px-8">
            <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-2xl uppercase text-center">
              Shop unreachable.
            </Text>
            <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm mt-2 text-center">
              Check your connection and try again.
            </Text>
            <Pressable
              onPress={() => { setFailed(false); setLoading(true); webRef.current?.reload(); }}
              className="mt-5 bg-atp-green rounded-atp px-6 py-3 active:opacity-80"
            >
              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.black }} className="text-sm uppercase tracking-widest">
                Retry
              </Text>
            </Pressable>
          </View>
        ) : (
          <>
            <WebView
              key={webKey}
              ref={webRef}
              source={{ uri: SHOP_URL }}
              style={{ flex: 1, backgroundColor: colors.black }}
              onLoadStart={() => setLoading(true)}
              onLoadEnd={() => setLoading(false)}
              onError={() => { setLoading(false); setFailed(true); }}
              onNavigationStateChange={onNavChange}
              injectedJavaScriptBeforeContentLoaded={prefillScript}
              // Keep the Store tab on Shopify (checkout included). Links
              // to any other host — e.g. the theme nav's "ATP World ↗" —
              // open in the system browser instead of trapping the
              // member logged-out inside this WebView.
              //
              // Founder items 4 + 6: iOS also asks here for every IFRAME
              // (isTopFrame=false). Checkout's card fields, Shop Pay and
              // 3-D Secure are iframes on other hosts, and bouncing them
              // to Safari sent members to a Shopify sign-in page and left
              // the in-app checkout stuck on "Express checkout". Iframes
              // now always load in place, and so does any hop a payment
              // makes while checkout is open, so the buyer comes back to
              // the thank-you page here.
              onShouldStartLoadWithRequest={(req) => {
                if (req.isTopFrame === false) return true;
                if (!/^https?:/.test(req.url)) return true;   // non-http scheme — let WebView decide
                if (isShopifyHost(req.url) || inCheckout.current) return true;
                Linking.openURL(req.url);
                return false;
              }}
              allowsBackForwardNavigationGestures
              sharedCookiesEnabled
              domStorageEnabled
              startInLoadingState={false}
              // Report 13 also said the shop "takes a long time to load".
              // It is the whole Shopify storefront, so it will never be
              // instant, but caching stops every visit being a cold load.
              cacheEnabled
              androidLayerType="hardware"
            />
            {loading && (
              <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.black }}>
                <ActivityIndicator color={colors.green} size="large" />
                <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted, marginTop: 12, letterSpacing: 1.5 }} className="text-xs uppercase">
                  Loading the shop…
                </Text>
              </View>
            )}
          </>
        )}
      </View>

      <OrderThankYou
        visible={thanks.visible}
        loading={thanks.loading}
        order={thanks.order}
        firstName={member?.first_name}
        onTrack={() => closeThanks(() => router.push('/orders'))}
        onClose={() => closeThanks()}
      />

      {/* MY REWARDS — native codes + wishlist */}
      {segment === 'rewards' && (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingBottom: 60 }}
          refreshControl={
            <RefreshControl
              tintColor={colors.green}
              refreshing={wishlistQ.isFetching || redempQ.isFetching}
              onRefresh={() => {
                qc.invalidateQueries({ queryKey: ['wishlist'] });
                qc.invalidateQueries({ queryKey: ['store-redemptions'] });
              }}
            />
          }
        >
          {/* Active codes */}
          <View className="px-5 mt-5">
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest mb-3">
              Your discount codes
            </Text>
            {activeCodes.length === 0 ? (
              <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm">
                Redeem ATP points for discount codes on the Rewards tab — they appear here ready to use at checkout.
              </Text>
            ) : (
              activeCodes.map((r) => (
                <View key={r.id} className="bg-atp-green/10 border border-atp-green/40 rounded-atp p-4 mb-2 flex-row items-center justify-between">
                  <View className="flex-1">
                    <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-lg tracking-widest">
                      {r.discount_code}
                    </Text>
                    <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-xs mt-1">
                      AED {r.aed_value.toFixed(2)} off · expires {r.expires_at ? new Date(r.expires_at).toLocaleDateString() : 'never'}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => openInShop(`/discount/${r.discount_code}`)}
                    className="bg-atp-green rounded-atp px-3 py-2 active:opacity-80"
                  >
                    <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.black }} className="text-xs uppercase tracking-widest">
                      Apply
                    </Text>
                  </Pressable>
                </View>
              ))
            )}
          </View>

          {/* Wishlist */}
          <View className="px-5 mt-7">
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest mb-3">
              Wishlist
            </Text>
            {wishlist.length === 0 ? (
              <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm">
                Nothing saved yet — browse the shop and your saved items will appear here.
              </Text>
            ) : (
              wishlist.map((item) => (
                <View key={item.product_id} className="bg-atp-dark border border-white/5 rounded-atp p-3 mb-2 flex-row items-center gap-3">
                  {item.product_image_url ? (
                    <Image source={{ uri: item.product_image_url }} className="w-14 h-14 rounded-atp" style={{ backgroundColor: colors.dark2 }} />
                  ) : (
                    <View className="w-14 h-14 rounded-atp bg-atp-dark-3 items-center justify-center">
                      <Text style={{ fontSize: 24 }}>🛍</Text>
                    </View>
                  )}
                  <View className="flex-1">
                    <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm" numberOfLines={1}>
                      {item.product_title || item.product_id}
                    </Text>
                    <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs mt-0.5">
                      Saved {new Date(item.added_at).toLocaleDateString()}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => openInShop(`/products/${item.product_id}`)}
                    className="bg-atp-green rounded-atp px-3 py-2 active:opacity-80"
                  >
                    <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.black }} className="text-xs uppercase tracking-widest">
                      View
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => Alert.alert(
                      'Remove from wishlist?',
                      item.product_title || item.product_id,
                      [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Remove', style: 'destructive', onPress: async () => {
                          try {
                            await removeFromWishlist(item.product_id);
                            qc.invalidateQueries({ queryKey: ['wishlist'] });
                          } catch (e: any) {
                            Alert.alert('Could not remove', e?.message || 'Try again.');
                          }
                        } },
                      ]
                    )}
                    className="bg-atp-dark-3 rounded-atp px-2 py-2 active:opacity-80"
                  >
                    <Text style={{ color: colors.muted }}>×</Text>
                  </Pressable>
                </View>
              ))
            )}
          </View>

          <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs mt-7 px-5 leading-relaxed">
            Earn points on every purchase. Free shipping over AED 250 across UAE. Returns within 14 days.
          </Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
