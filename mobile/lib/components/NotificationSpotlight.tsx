/**
 * New-notification spotlight (founder 2026-09-18).
 *
 * On app open, once the sponsor promo is out of the way, the newest
 * UNREAD notification takes the screen — big, lime-framed, impossible
 * to miss. Tapping it opens whatever it's about and marks it read.
 *
 * Rules that keep it from becoming a nuisance:
 *   · only ever the single newest unread notification
 *   · each notification spotlights ONCE, tracked by id in SecureStore,
 *     so reopening the app doesn't replay the same one
 *   · nothing to show → renders nothing, silently
 *   · never competes with the promo: it waits for whenPromoSettled()
 */
import { useEffect, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useQueryClient } from '@tanstack/react-query';
import { listNotifications, markNotificationRead, type AppNotification } from '@/lib/api/notifications';
import { useAuthStore } from '@/lib/stores/auth.store';
import { whenPromoSettled } from '@/lib/stores/appOpen';
import { colors, fontFamily } from '@/lib/theme/tokens';

const SEEN_KEY = 'atp_spotlight_last_id';

/** Only ever runs once per cold start. */
let ranThisLaunch = false;

/** Where a notification should take you — mirrors inbox/index.tsx. */
function notifTarget(n: AppNotification): string | null {
  let d = n.data;
  if (typeof d === 'string') { try { d = JSON.parse(d); } catch { d = null; } }
  if (d?.session_id) return `/sessions/${d.session_id}`;
  if (d?.post_id) return `/community/post/${d.post_id}`;
  if (n.type === 'friend_request') return '/(tabs)/community?tab=friends';
  return '/inbox';
}

/** A human label for the kind of notification, used as the eyebrow. */
function kindLabel(type: string): string {
  switch (type) {
    case 'friend_request':    return 'Friend request';
    case 'streak_milestone':  return 'Streak milestone';
    case 'session_reminder':  return 'Session reminder';
    case 'session_feedback':  return 'How was it?';
    case 'session_cancelled': return 'Session cancelled';
    case 'points':            return 'Points';
    case 'achievement':       return 'New badge';
    default:                  return 'New notification';
  }
}

export function NotificationSpotlight() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const qc = useQueryClient();
  const [item, setItem] = useState<AppNotification | null>(null);

  useEffect(() => {
    if (!accessToken || ranThisLaunch) return;
    ranThisLaunch = true;
    let cancelled = false;

    (async () => {
      try {
        await whenPromoSettled();
        if (cancelled) return;

        const res = await listNotifications(10);
        if (cancelled) return;

        const newest = (res.notifications || []).find((n) => !n.read_at);
        if (!newest) return;

        // Already spotlighted on a previous open? Leave it alone — it's
        // still in the bell, which is where a repeat belongs.
        const lastId = await SecureStore.getItemAsync(SEEN_KEY).catch(() => null);
        if (cancelled || lastId === String(newest.id)) return;

        await SecureStore.setItemAsync(SEEN_KEY, String(newest.id)).catch(() => {});
        if (!cancelled) setItem(newest);
      } catch {
        // A notification popup is never worth an error on app open.
      }
    })();

    return () => { cancelled = true; };
  }, [accessToken]);

  if (!item) return null;

  const dismiss = () => setItem(null);

  const openIt = async () => {
    const target = notifTarget(item);
    setItem(null);
    try {
      await markNotificationRead(item.id);
      qc.invalidateQueries({ queryKey: ['notifications'] });
    } catch { /* the badge self-corrects on its next refetch */ }
    if (target) router.push(target as any);
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={dismiss}>
      <Pressable
        onPress={dismiss}
        className="flex-1 items-center justify-center px-6"
        style={{ backgroundColor: 'rgba(0,0,0,0.88)' }}
      >
        <Pressable onPress={(e) => e.stopPropagation()} style={{ width: '100%' }}>
          <View
            className="rounded-atp-lg overflow-hidden bg-atp-dark"
            style={{ borderWidth: 2, borderColor: colors.green }}
          >
            {/* Lime banner — the "very highlighted" part */}
            <View style={{ backgroundColor: colors.green }} className="px-5 py-3 flex-row items-center justify-between">
              <Text
                style={{ fontFamily: fontFamily.displayBlack, color: colors.black }}
                className="text-base uppercase tracking-tight"
              >
                {kindLabel(item.type)}
              </Text>
              <View style={{ backgroundColor: colors.black }} className="px-2.5 py-1 rounded-full">
                <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-[9px] uppercase tracking-widest">
                  New
                </Text>
              </View>
            </View>

            <View className="px-5 pt-5 pb-4">
              {!!item.title && (
                <Text
                  style={{ fontFamily: fontFamily.displayBlack, color: colors.white }}
                  className="text-2xl uppercase tracking-tight"
                >
                  {item.title}
                </Text>
              )}
              {!!item.body && (
                <Text
                  style={{ fontFamily: fontFamily.body, color: colors.light }}
                  className="text-sm mt-2.5 leading-relaxed"
                >
                  {item.body}
                </Text>
              )}
            </View>

            <View className="px-5 pb-5 gap-2.5">
              <Pressable
                onPress={openIt}
                style={{ backgroundColor: colors.green }}
                className="rounded-atp py-3.5 items-center active:opacity-80"
              >
                <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.black }} className="text-sm uppercase tracking-widest">
                  Take a look
                </Text>
              </Pressable>
              <Pressable onPress={dismiss} className="py-2.5 items-center active:opacity-70">
                <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs uppercase tracking-widest">
                  Later
                </Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
