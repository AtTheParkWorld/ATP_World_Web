/**
 * Compact session card used in lists (Sessions tab, Home next-session,
 * Sessions detail "similar" rail). Tap → /sessions/[id] unless the
 * parent overrides onPress.
 *
 * Variants:
 *   - default: full card with title + time + city + capacity
 *   - compact: tighter spacing for Home's stacked carousel
 */
import { memo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import type { Session } from '@/lib/api/sessions';
import { colors, fontFamily, tribeColor } from '@/lib/theme/tokens';
import { timeShort, relativeStartLabel } from '@/lib/utils/date';

interface Props {
  session: Session;
  compact?: boolean;
  onPress?: () => void;
}

function _SessionCard({ session, compact, onPress }: Props) {
  const isFull   = session.capacity != null && session.registrations_count >= session.capacity;
  const tColor   = tribeColor(session.tribe_slug);
  const live     = session.is_live_now || (session.minutes_until_start != null && session.minutes_until_start >= -10 && session.minutes_until_start <= 0);
  const priceLbl = session.session_type === 'paid' && session.price
    ? `${session.currency_code || 'AED'} ${session.price}`
    : 'Free';

  return (
    <Pressable
      onPress={onPress || (() => router.push(`/sessions/${session.id}`))}
      className="bg-atp-dark rounded-atp-lg border border-white/5 active:opacity-70"
      style={{ padding: compact ? 14 : 18 }}
    >
      {/* Tribe accent strip */}
      <View
        className="absolute top-0 left-0 bottom-0 rounded-l-atp-lg"
        style={{ width: 4, backgroundColor: tColor }}
      />

      <View className="flex-row items-start justify-between">
        <View className="flex-1 pr-3">
          <View className="flex-row items-center gap-2 mb-1">
            {!!session.tribe_name && (
              <Text
                style={{ fontFamily: fontFamily.bodyBold, color: tColor }}
                className="text-xs uppercase tracking-widest"
              >
                {session.tribe_name}
              </Text>
            )}
            {live && (
              <View className="px-2 py-0.5 rounded bg-atp-red">
                <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-[10px] uppercase tracking-widest">
                  Live
                </Text>
              </View>
            )}
          </View>
          <Text
            style={{ fontFamily: fontFamily.displayBlack }}
            className="text-atp-white uppercase tracking-tight"
            numberOfLines={2}
          >
            <Text className={compact ? 'text-lg' : 'text-xl'}>{session.name}</Text>
          </Text>
        </View>
        <View className="items-end">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-base">
            {timeShort(session.scheduled_at)}
          </Text>
          <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs mt-0.5">
            {relativeStartLabel(session.scheduled_at)}
          </Text>
        </View>
      </View>

      <View className="flex-row items-center gap-3 mt-3">
        {!!session.city_name && (
          <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-xs">
            📍 {session.city_name}
          </Text>
        )}
        {!!session.activity_name && (
          <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-xs">
            {session.activity_icon || '•'} {session.activity_name}
          </Text>
        )}
        <Text style={{ fontFamily: fontFamily.body, color: isFull ? colors.danger : colors.light }} className="text-xs">
          {isFull
            ? `Full · waitlist (${session.waitlist_count})`
            : `${session.registrations_count}${session.capacity ? '/' + session.capacity : ''} joined`}
        </Text>
        <View className="ml-auto">
          <Text
            style={{
              fontFamily: fontFamily.bodyBold,
              color: session.session_type === 'paid' ? colors.warning : colors.green,
            }}
            className="text-xs uppercase tracking-widest"
          >
            {priceLbl}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

export const SessionCard = memo(_SessionCard);
