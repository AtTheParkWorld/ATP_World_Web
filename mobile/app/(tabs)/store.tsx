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
 */
import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getWishlist, getRedemptionHistory, removeFromWishlist } from '@/lib/api/store';
import { colors, fontFamily } from '@/lib/theme/tokens';

const SHOP_URL = 'https://shop.atthepark.world';

type Segment = 'shop' | 'rewards';

export default function StoreHub() {
  const qc = useQueryClient();
  const webRef = useRef<WebView>(null);
  const [segment, setSegment]   = useState<Segment>('shop');
  const [loading, setLoading]   = useState(true);
  const [failed, setFailed]     = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);

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
              ref={webRef}
              source={{ uri: SHOP_URL }}
              style={{ flex: 1, backgroundColor: colors.black }}
              onLoadStart={() => setLoading(true)}
              onLoadEnd={() => setLoading(false)}
              onError={() => { setLoading(false); setFailed(true); }}
              onNavigationStateChange={(nav) => setCanGoBack(nav.canGoBack)}
              allowsBackForwardNavigationGestures
              sharedCookiesEnabled
              domStorageEnabled
              startInLoadingState={false}
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
                Tap the ♡ icon on any product in the shop to save it here.
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
