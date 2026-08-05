/**
 * Compact session card used in lists (Sessions tab, Home next-session,
 * Sessions detail "similar" rail). Tap → /sessions/[id] unless the
 * parent overrides onPress.
 *
 * Variants:
 *   - default: full card with title + time + city + capacity. If the
 *     session has an intro_video_url it autoplays muted + looping at
 *     the top of the card (mobile stand-in for the web hover preview).
 *   - compact: tighter spacing for Home's stacked carousel (no video)
 */
import { memo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { VideoView, useVideoPlayer } from 'expo-video';
import type { Session } from '@/lib/api/sessions';
import { IconLock } from '@/lib/components/icons';
import { colors, fontFamily, tribeColor } from '@/lib/theme/tokens';
import { absUrl } from '@/lib/utils/imageUrl';
import { timeShort, relativeStartLabel } from '@/lib/utils/date';

/** Premium gold reserved for company-exclusive + paid perks (mirrors
 *  the web's #f5c042 — 1-on-1 coaching, gifts, paid price pills). */
const CORP_GOLD        = '#f5c042';
const CORP_GOLD_FILL   = 'rgba(245,192,66,0.12)';
const CORP_GOLD_STROKE = 'rgba(245,192,66,0.32)';

/**
 * Private-company session pill. Sized/typed to match the card's other
 * chips (10px, uppercase, widest tracking, bodyBold) but in gold with a
 * hairline outline + padlock so it reads as an exclusive perk rather
 * than as another tribe tag.
 */
export function CorporateSessionBadge({ companyName }: { companyName?: string | null }) {
  const label = (companyName || '').trim() || 'Private session';
  return (
    <View
      className="flex-row items-center rounded-full px-2 py-0.5"
      style={{
        backgroundColor: CORP_GOLD_FILL,
        borderWidth: 1,
        borderColor: CORP_GOLD_STROKE,
        flexShrink: 1,
      }}
    >
      <IconLock size={9} color={CORP_GOLD} strokeWidth={2.5} />
      <Text
        numberOfLines={1}
        style={{ fontFamily: fontFamily.bodyBold, color: CORP_GOLD, marginLeft: 4 }}
        className="text-[10px] uppercase tracking-widest"
      >
        {label}
      </Text>
    </View>
  );
}

/**
 * Mobile translation of the website's hover-preview: /sessions plays
 * `intro_video_url` in a popup while the cursor hovers a card. Touch
 * has no hover, so cards WITH a video autoplay it muted + looping
 * inline (Instagram-feed style) — same pattern as PostCard's FeedVideo.
 * This component is only ever MOUNTED when the session has a video, so
 * video-less cards (the majority) pay zero player cost.
 */
function SessionPreviewVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });
  return (
    <VideoView
      player={player}
      style={{ width: '100%', aspectRatio: 16 / 9, borderRadius: 12, backgroundColor: '#000', marginBottom: 12 }}
      contentFit="cover"
      nativeControls={false}
    />
  );
}

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

      {/* Hover-preview video, mobile edition — autoplay muted + loop.
          Full-size cards only (compact rails stay text-only), and only
          mounted when the session actually has a video. pointerEvents
          "none" keeps the whole card tappable through the video. */}
      {!compact && !!session.intro_video_url && (
        <View pointerEvents="none">
          <SessionPreviewVideo uri={absUrl(session.intro_video_url)!} />
        </View>
      )}

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
            {!!session.is_corporate_only && (
              <CorporateSessionBadge companyName={session.corporate_company_name} />
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
