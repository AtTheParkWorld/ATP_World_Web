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
 */
import { Modal, Pressable, ScrollView, Text, View, Image, useWindowDimensions } from 'react-native';
import { type Achievement, rarityLabel } from '@/lib/api/achievements';
import { colors, fontFamily } from '@/lib/theme/tokens';

function rarityColor(r?: string | null): string {
  if (r === 'legendary') return '#f5c042';
  if (r === 'rare') return '#9ad4ff';
  return colors.green;
}

export function BadgeDetail({ badge, onClose }: { badge: Achievement | null; onClose: () => void }) {
  const { width } = useWindowDimensions();
  if (!badge) return null;

  const accent = rarityColor(badge.rarity);
  const artSize = Math.min(width - 120, 220);
  const earned = badge.unlocked_at
    ? new Date(badge.unlocked_at).toLocaleDateString(undefined, {
        day: 'numeric', month: 'long', year: 'numeric',
      })
    : null;

  return (
    <Modal animationType="fade" transparent visible onRequestClose={onClose}>
      <Pressable onPress={onClose} className="flex-1 bg-black/85 justify-center px-6">
        <Pressable onPress={(e) => e.stopPropagation()}>
          <View
            className="bg-atp-dark rounded-atp-lg border overflow-hidden"
            style={{ borderColor: accent, maxHeight: '86%' }}
          >
            <ScrollView contentContainerStyle={{ padding: 24, alignItems: 'center' }}>
              {/* Art — whole, uncropped, on its own plate */}
              <View
                className="rounded-atp-lg items-center justify-center mb-5"
                style={{
                  width: artSize,
                  height: artSize,
                  backgroundColor: 'rgba(255,255,255,0.03)',
                  borderWidth: 1,
                  borderColor: `${accent}55`,
                }}
              >
                {badge.badge_image_url ? (
                  <Image
                    source={{ uri: badge.badge_image_url }}
                    style={{ width: artSize - 24, height: artSize - 24 }}
                    resizeMode="contain"
                  />
                ) : (
                  <Text style={{ fontSize: artSize * 0.46 }}>{badge.icon || '🏅'}</Text>
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
                <Text
                  style={{ fontFamily: fontFamily.body, color: colors.light }}
                  className="text-sm mt-3 leading-relaxed w-full"
                >
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
                  <Text
                    style={{ fontFamily: fontFamily.body, color: colors.light }}
                    className="text-sm leading-relaxed"
                  >
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
        </Pressable>
      </Pressable>
    </Modal>
  );
}
