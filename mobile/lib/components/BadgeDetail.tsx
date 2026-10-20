/**
 * BadgeDetail — tap an unlocked badge, see the art full size and read
 * the story behind it (founder 2026-09-17).
 *
 * Only unlocked badges open. That's the point: the story is part of
 * the reward, so a locked badge keeps it hidden and stays worth
 * earning. A badge with no story written yet still opens — the member
 * gets the full-size art, the rarity and the date they earned it.
 *
 * Art is rendered with resizeMode="contain" on a square, never cropped
 * to a circle, so elaborate badge artwork survives intact (the grid
 * thumbnails used to crop the edges off).
 *
 * Every story is longer than the card (500–800 characters), so the card
 * SCROLLS — and has to look like it does. On a Galaxy S24 the founder saw
 * the story stop mid-line at the Close bar (2026-10-21): Android hides the
 * scrollbar until you drag, and the ScrollView sat inside a Pressable,
 * which can swallow the drag. Now: the backdrop is a sibling (nothing
 * wraps the ScrollView), the scrollbar stays visible, a fade + "Scroll for
 * the full story" sits on the cut edge until you reach the end, and the
 * text uses a whole-pixel line height (Android clips the last line of
 * long text when the line height is fractional).
 */
import { useEffect, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View, Image, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { type Achievement, rarityLabel } from '@/lib/api/achievements';
import { colors, fontFamily } from '@/lib/theme/tokens';

function rarityColor(r?: string | null): string {
  if (r === 'legendary') return '#f5c042';
  if (r === 'rare') return '#9ad4ff';
  return colors.green;
}

// Whole-pixel line height + simple line breaking: Android measures and
// draws long text the same way, so the last line can't be clipped.
const BODY_TEXT = {
  fontFamily: fontFamily.body, color: colors.light, fontSize: 14, lineHeight: 22,
  ...(Platform.OS === 'android' ? { textBreakStrategy: 'simple' as const } : null),
};
// Fade over the cut edge — stacked strips, no gradient library needed.
const FADE = [0.2, 0.4, 0.6, 0.8, 0.92];

export function BadgeDetail({ badge, onClose }: { badge: Achievement | null; onClose: () => void }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // Scroll position, visible height and content height → is there more
  // below the fold? Reset for every badge opened.
  const [scroll, setScroll] = useState({ y: 0, view: 0, content: 0 });
  useEffect(() => { setScroll({ y: 0, view: 0, content: 0 }); }, [badge?.id]);
  const more = scroll.view > 0 && scroll.y + scroll.view < scroll.content - 24;
  if (!badge) return null;

  const accent = rarityColor(badge.rarity);
  // Smaller art on short screens so more of the story shows up front.
  const artSize = Math.round(Math.min(width - 96, 260, height * 0.3));
  // A real number, not '86%' of an auto-height parent.
  const cardMax = Math.round(Math.min(height * 0.88, height - insets.top - insets.bottom - 48));
  const earned = badge.unlocked_at
    ? new Date(badge.unlocked_at).toLocaleDateString(undefined, {
        day: 'numeric', month: 'long', year: 'numeric',
      })
    : null;

  return (
    <Modal animationType="fade" transparent visible onRequestClose={onClose} statusBarTranslucent>
      <View className="flex-1 bg-black/85 justify-center px-6" style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
        {/* Backdrop is a SIBLING of the card — tapping outside closes, and
            no touchable wraps the ScrollView to steal the drag. */}
        <Pressable onPress={onClose} style={StyleSheet.absoluteFill} accessibilityLabel="Close" />
        <View
          className="bg-atp-dark rounded-atp-lg border overflow-hidden"
          style={{ borderColor: accent, maxHeight: cardMax }}
        >
          <View style={{ flexShrink: 1 }}>
            <ScrollView
              contentContainerStyle={{ padding: 24, paddingBottom: 32, alignItems: 'center' }}
              persistentScrollbar
              indicatorStyle="white"
              scrollEventThrottle={32}
              onLayout={(e) => { const v = e.nativeEvent.layout.height; setScroll((p) => ({ ...p, view: v })); }}
              onContentSizeChange={(_, h) => setScroll((p) => ({ ...p, content: h }))}
              onScroll={({ nativeEvent: n }) => {
                const y = n.contentOffset.y;
                setScroll((p) => (Math.abs(p.y - y) < 8 ? p : { ...p, y }));
              }}
            >
              {/* Art — whole, uncropped, and unframed. No plate behind
                  it (founder 2026-09-18): the badge is the subject, so
                  nothing boxes it in. A drop shadow lifts it off the
                  sheet instead of a border. */}
              <View className="items-center justify-center mb-5" style={{ width: artSize, height: artSize }}>
                {badge.badge_image_url ? (
                  <Image
                    source={{ uri: badge.badge_image_url }}
                    style={{
                      width: artSize, height: artSize,
                      // Circular clip: some badges were exported without
                      // transparency and carried a black square (founder
                      // 2026-09-18). Every ATP badge is a round medallion.
                      borderRadius: artSize / 2,
                      shadowColor: '#000', shadowOpacity: 0.6,
                      shadowRadius: 18, shadowOffset: { width: 0, height: 8 },
                    }}
                    resizeMode="contain"
                  />
                ) : (
                  <Text style={{ fontSize: artSize * 0.58 }}>{badge.icon || '🏅'}</Text>
                )}
              </View>

              {!!rarityLabel(badge.rarity) && (
                <Text
                  style={{ fontFamily: fontFamily.bodyBold, color: accent }}
                  className="text-[10px] uppercase tracking-[3px] mb-2"
                >
                  {rarityLabel(badge.rarity)}
                </Text>
              )}

              <Text
                style={{ fontFamily: fontFamily.displayBlack, color: colors.white }}
                className="text-2xl uppercase tracking-tight text-center"
              >
                {badge.name}
              </Text>

              {/* Left-aligned and full width: descriptions are often
                  pasted as several lines, and centring turned them into a
                  ragged block (founder 2026-09-18). React Native keeps the
                  line breaks as typed. */}
              {!!badge.description && (
                <Text style={BODY_TEXT} className="mt-3 w-full">
                  {badge.description}
                </Text>
              )}

              {/* The story — the reason to tap */}
              {!!badge.story && (
                <View className="mt-6 w-full">
                  <View className="flex-row items-center gap-3 mb-3">
                    <View className="flex-1 h-px" style={{ backgroundColor: `${accent}40` }} />
                    <Text
                      style={{ fontFamily: fontFamily.bodyBold, color: accent }}
                      className="text-[10px] uppercase tracking-[2px]"
                    >
                      The story
                    </Text>
                    <View className="flex-1 h-px" style={{ backgroundColor: `${accent}40` }} />
                  </View>
                  <Text style={BODY_TEXT}>
                    {badge.story}
                  </Text>
                </View>
              )}

              {/* Provenance — when you earned it, how rare it is */}
              <View className="mt-6 w-full border-t border-white/10 pt-4 gap-1.5">
                {!!earned && (
                  <View className="flex-row justify-between">
                    <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs">
                      Earned
                    </Text>
                    <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-xs">
                      {earned}
                    </Text>
                  </View>
                )}
                {badge.points_reward > 0 && (
                  <View className="flex-row justify-between">
                    <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs">
                      Reward
                    </Text>
                    <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-xs">
                      +{badge.points_reward} pts
                    </Text>
                  </View>
                )}
                {badge.max_recipients != null && (
                  <View className="flex-row justify-between">
                    <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs">
                      Edition
                    </Text>
                    <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-xs">
                      {badge.claimed_count ?? 0} of {badge.max_recipients} claimed
                    </Text>
                  </View>
                )}
              </View>
            </ScrollView>
            {more && (
              <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
                {FADE.map((o) => (
                  <View key={o} style={{ height: 6, backgroundColor: `rgba(17,17,17,${o})` }} />
                ))}
                <View style={{ backgroundColor: 'rgba(17,17,17,0.96)', paddingBottom: 8, alignItems: 'center' }}>
                  <Text style={{ fontFamily: fontFamily.bodyBold, color: accent }} className="text-[10px] uppercase tracking-[2px]">
                    Scroll for the full story ↓
                  </Text>
                </View>
              </View>
            )}
          </View>

          <Pressable
            onPress={onClose}
            className="py-4 items-center border-t border-white/10 active:opacity-70"
          >
            <Text
              style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }}
              className="text-xs uppercase tracking-widest"
            >
              Close
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
