/**
 * Unified bell (founder 2026-09-09: "consolidate messages and
 * notification bells" — the website got one, the app had none).
 *
 * The badge counts unread NOTIFICATIONS + unread MESSAGES together, so
 * one dot means "something is waiting for you" regardless of kind.
 * Tapping opens /inbox, which shows both in one list.
 *
 * Both queries live on shared keys (['notifications'], ['conversations'])
 * so the inbox, the messages screen and this badge stay in lockstep
 * through the React Query cache.
 */
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { listNotifications } from '@/lib/api/notifications';
import { listConversations } from '@/lib/api/messages';
import { useAuthStore } from '@/lib/stores/auth.store';
import { Icon } from '@/lib/components/icons';
import { colors, fontFamily } from '@/lib/theme/tokens';

export function NotificationBell({ size = 22 }: { size?: number }) {
  const signedIn = !!useAuthStore((s) => s.accessToken);

  const notifQ = useQuery({
    queryKey: ['notifications'],
    queryFn: () => listNotifications(30),
    enabled: signedIn,
    refetchInterval: 60_000,
  });
  const convQ = useQuery({
    queryKey: ['conversations'],
    queryFn: () => listConversations().then((r) => r.conversations),
    enabled: signedIn,
    refetchInterval: 60_000,
  });

  const unreadNotifs = notifQ.data?.unread_count ?? 0;
  const unreadMsgs = (convQ.data || []).reduce(
    (sum, c) => sum + (Number(c.unread_count) || 0),
    0
  );
  const total = unreadNotifs + unreadMsgs;

  return (
    <Pressable
      onPress={() => router.push('/inbox')}
      hitSlop={10}
      style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.92 : 1 }] })}
      accessibilityLabel={total > 0 ? `Inbox, ${total} unread` : 'Inbox'}
    >
      <Icon name="notification" size={size} color={colors.white} />
      {total > 0 && (
        <View
          className="absolute bg-atp-green rounded-full items-center justify-center"
          style={{ top: -4, right: -6, minWidth: 17, height: 17, paddingHorizontal: 4 }}
        >
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.black, fontSize: 10 }}>
            {total > 99 ? '99+' : total}
          </Text>
        </View>
      )}
    </Pressable>
  );
}
