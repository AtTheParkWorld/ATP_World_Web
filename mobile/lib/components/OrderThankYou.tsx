/**
 * Post-purchase thank-you sheet for the Store tab (founder item 6,
 * 2026-10-06): "After payment when returning to the Store the Express
 * checkout still there. Kindly create a friendly appreciation for their
 * purchase and a confirmation of the same."
 *
 * Shown the moment Shopify lands on its thank-you page (or when the app
 * comes back to the foreground and a new order shows up). The order
 * itself comes from GET /store/orders, which can lag the payment by a
 * few seconds — until it arrives the sheet still confirms the purchase
 * and says the receipt is on its way.
 */
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Icon } from '@/lib/components/icons';
import { formatMoney, type ShopOrder } from '@/lib/api/store';
import { colors, fontFamily } from '@/lib/theme/tokens';

const MAX_ITEMS = 4;

export function OrderThankYou({
  visible,
  loading,
  order,
  firstName,
  onTrack,
  onClose,
}: {
  visible: boolean;
  loading: boolean;
  order: ShopOrder | null;
  firstName?: string | null;
  onTrack: () => void;
  onClose: () => void;
}) {
  const items = order?.items || [];
  const extra = Math.max(0, items.length - MAX_ITEMS);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' }}>
        <View
          className="bg-atp-black border-t border-atp-green/40"
          style={{ borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '88%' }}
        >
          <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 40 }}>
            <View className="items-center">
              <View
                style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: colors.green }}
                className="items-center justify-center"
              >
                <Icon name="check" size={32} color={colors.black} />
              </View>
              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green, letterSpacing: 2 }} className="text-xs uppercase mt-5">
                Order confirmed{order ? ` · ${order.number}` : ''}
              </Text>
              <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-3xl uppercase text-center mt-2">
                Thank you{firstName ? `, ${firstName}` : ''}!
              </Text>
              <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-sm text-center mt-3 leading-relaxed">
                Every piece you wear keeps ATP sessions free for the whole crew. We're packing your gear now —
                your receipt is on its way to your inbox.
              </Text>
              <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.green }} className="text-lg uppercase tracking-widest mt-3">
                Never Train Alone.
              </Text>
            </View>

            {/* Order summary — appears as soon as Shopify reports it. */}
            <View className="mt-6 bg-atp-dark border border-white/5 rounded-atp-lg p-4">
              {loading && !order ? (
                <View className="flex-row items-center justify-center py-3">
                  <ActivityIndicator color={colors.green} />
                  <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs ml-3">
                    Fetching your order details…
                  </Text>
                </View>
              ) : order ? (
                <>
                  {items.slice(0, MAX_ITEMS).map((it, i) => (
                    <View key={i} className={`flex-row items-center ${i ? 'mt-3' : ''}`}>
                      {it.image_url ? (
                        <Image source={{ uri: it.image_url }} style={{ width: 48, height: 48, borderRadius: 8, backgroundColor: colors.dark2 }} />
                      ) : (
                        <View style={{ width: 48, height: 48, borderRadius: 8 }} className="bg-atp-dark-3 items-center justify-center">
                          <Icon name="bag" size={20} color={colors.muted} />
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
                  {extra > 0 && (
                    <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs mt-3">
                      + {extra} more item{extra > 1 ? 's' : ''}
                    </Text>
                  )}
                  <View className="flex-row justify-between items-center mt-4 pt-3 border-t border-white/5">
                    <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest">
                      Total
                    </Text>
                    <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-xl">
                      {formatMoney(order.total, order.currency)}
                    </Text>
                  </View>
                </>
              ) : (
                <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs text-center leading-relaxed">
                  Your order is in. It will appear in My orders within a minute, with tracking as soon as it ships.
                </Text>
              )}
            </View>

            <Pressable onPress={onTrack} className="mt-6 bg-atp-green rounded-atp py-4 items-center active:opacity-80">
              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.black }} className="text-sm uppercase tracking-widest">
                Track your order
              </Text>
            </Pressable>
            <Pressable onPress={onClose} className="mt-3 border border-white/15 rounded-atp py-4 items-center active:opacity-70">
              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm uppercase tracking-widest">
                Keep shopping
              </Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
