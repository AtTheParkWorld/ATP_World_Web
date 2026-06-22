/**
 * Store hub — entry point to the ATP merchandise shop.
 *
 * The actual product catalogue + checkout live on shop.atthepark.world
 * (Shopify-hosted). We open it in an in-app browser so members stay
 * inside the ATP shell. Mobile-side we surface:
 *   - a hero "Visit shop" button
 *   - the member's recent points-redemption codes (active first)
 *   - the wishlist (so members can hit "Buy now" → opens product page)
 */
import { Alert, FlatList, Image, Linking, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as WebBrowser from 'expo-web-browser';
import { getWishlist, getRedemptionHistory, removeFromWishlist } from '@/lib/api/store';
import { colors, fontFamily } from '@/lib/theme/tokens';

const SHOP_URL = 'https://shop.atthepark.world';

export default function StoreHub() {
  const qc = useQueryClient();
  const wishlistQ = useQuery({ queryKey: ['wishlist'], queryFn: () => getWishlist().then(r => r.items) });
  const redempQ   = useQuery({ queryKey: ['store-redemptions'], queryFn: () => getRedemptionHistory().then(r => r.redemptions) });

  const activeCodes = (redempQ.data || []).filter((r) => r.status === 'issued');
  const wishlist    = wishlistQ.data || [];

  return (
    <SafeAreaView className="flex-1 bg-atp-black" edges={['top']}>
      <View className="px-5 pt-2 pb-3 flex-row items-center border-b border-white/5">
        <Pressable onPress={() => router.back()} className="py-2 -ml-2 px-2">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-lg">←</Text>
        </Pressable>
        <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-lg uppercase ml-2">
          Store
        </Text>
      </View>

      <ScrollView
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
        {/* Hero */}
        <View className="px-5 pt-5">
          <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-4xl uppercase tracking-tight">
            ATP{'\n'}gear.
          </Text>
          <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-base mt-3 leading-relaxed">
            Train in the colours. Shipped across the UAE, GCC, and beyond. Members earn points on every purchase.
          </Text>
          <Pressable
            onPress={() => WebBrowser.openBrowserAsync(SHOP_URL)}
            className="mt-5 bg-atp-green rounded-atp py-4 items-center active:opacity-80"
          >
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.black }} className="text-base uppercase tracking-widest">
              Visit the ATP shop →
            </Text>
          </Pressable>
        </View>

        {/* Active codes */}
        {activeCodes.length > 0 && (
          <View className="px-5 mt-7">
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest mb-3">
              Your discount codes
            </Text>
            {activeCodes.map((r) => (
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
                  onPress={() => WebBrowser.openBrowserAsync(`${SHOP_URL}/discount/${r.discount_code}`)}
                  className="bg-atp-green rounded-atp px-3 py-2 active:opacity-80"
                >
                  <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.black }} className="text-xs uppercase tracking-widest">
                    Apply
                  </Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}

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
                  onPress={() => WebBrowser.openBrowserAsync(`${SHOP_URL}/products/${item.product_id}`)}
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

        {/* Bottom info */}
        <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs mt-7 px-5 leading-relaxed">
          Earn points on every purchase. Free shipping over AED 250 across UAE. Returns within 14 days.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
