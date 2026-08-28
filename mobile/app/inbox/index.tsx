/**
 * Inbox — messages and notifications in one place (founder 2026-09-09).
 * The bell badge counts both, so tapping it must show both; splitting
 * them across two screens is exactly the confusion we removed on the
 * website.
 *
 * Messages section routes into the existing 1:1 thread; notifications
 * mark themselves read on tap and deep-link when their payload knows
 * where to go.
 */
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listNotifications, markAllNotificationsRead, markNotificationRead, type AppNotification } from '@/lib/api/notifications';
import { listConversations, type Conversation } from '@/lib/api/messages';
import { Avatar } from '@/lib/components/Avatar';
import { Icon } from '@/lib/components/icons';
import { colors, fontFamily } from '@/lib/theme/tokens';

function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/** Where a notification should take you, when its payload knows. */
function notifTarget(n: AppNotification): string | null {
  let d = n.data;
  if (typeof d === 'string') { try { d = JSON.parse(d); } catch { d = null; } }
  if (!d) return null;
  if (d.session_id) return `/sessions/${d.session_id}`;
  if (d.post_id) return `/community/post/${d.post_id}`;
  if (n.type === 'friend_request') return '/(tabs)/community';
  return null;
}

export default function Inbox() {
  const qc = useQueryClient();

  const notifQ = useQuery({ queryKey: ['notifications'], queryFn: () => listNotifications(30) });
  const convQ = useQuery({ queryKey: ['conversations'], queryFn: () => listConversations().then((r) => r.conversations) });

  const conversations = convQ.data || [];
  const notifications = notifQ.data?.notifications || [];
  const unreadNotifs = notifQ.data?.unread_count ?? 0;
  const loading = notifQ.isLoading || convQ.isLoading;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['notifications'] });
    qc.invalidateQueries({ queryKey: ['conversations'] });
  };

  const openNotification = async (n: AppNotification) => {
    if (!n.read_at) {
      try { await markNotificationRead(n.id); } catch { /* badge will self-correct on refetch */ }
      qc.invalidateQueries({ queryKey: ['notifications'] });
    }
    const target = notifTarget(n);
    if (target) router.push(target as any);
  };

  return (
    <SafeAreaView className="flex-1 bg-atp-black" edges={['top']}>
      <View className="px-5 pt-2 pb-3 flex-row items-center border-b border-white/5">
        <Pressable onPress={() => router.back()} className="py-2 -ml-2 px-2">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-lg">←</Text>
        </Pressable>
        <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-lg uppercase ml-2">
          Inbox
        </Text>
        {unreadNotifs > 0 && (
          <Pressable
            onPress={async () => {
              try { await markAllNotificationsRead(); } catch {}
              qc.invalidateQueries({ queryKey: ['notifications'] });
            }}
            className="ml-auto py-2 px-2"
          >
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-[11px] uppercase tracking-widest">
              Mark all read
            </Text>
          </Pressable>
        )}
      </View>

      {loading ? (
        <ActivityIndicator color={colors.green} className="mt-10" />
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={(n) => `n-${n.id}`}
          contentContainerStyle={{ padding: 20, paddingBottom: 60 }}
          refreshControl={
            <RefreshControl
              tintColor={colors.green}
              refreshing={notifQ.isFetching || convQ.isFetching}
              onRefresh={refresh}
            />
          }
          ListHeaderComponent={
            <View>
              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest mb-3">
                Messages
              </Text>
              {conversations.length === 0 ? (
                <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm mb-6">
                  No messages yet.
                </Text>
              ) : (
                <View className="mb-6">
                  {conversations.slice(0, 8).map((c: Conversation) => {
                    const unread = Number(c.unread_count) || 0;
                    return (
                      <Pressable
                        key={String(c.id)}
                        onPress={() => router.push(`/messages/${c.other_id}`)}
                        style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }] })}
                        className={`flex-row items-center gap-3 rounded-atp-lg px-4 py-3 mb-2 border ${unread > 0 ? 'bg-atp-green/5 border-atp-green/30' : 'bg-atp-dark border-white/5'}`}
                      >
                        <Avatar uri={c.other_avatar} firstName={c.other_first} lastName={c.other_last} id={c.other_id} size="md" />
                        <View className="flex-1">
                          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm" numberOfLines={1}>
                            {`${c.other_first || ''} ${c.other_last || ''}`.trim() || 'ATP member'}
                          </Text>
                          {!!c.last_message && (
                            <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs mt-0.5" numberOfLines={1}>
                              {c.last_message}
                            </Text>
                          )}
                        </View>
                        <View className="items-end">
                          <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-[10px]">
                            {timeAgo(c.last_message_at)}
                          </Text>
                          {unread > 0 && (
                            <View className="bg-atp-green rounded-full px-2 py-0.5 mt-1">
                              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.black, fontSize: 10 }}>{unread}</Text>
                            </View>
                          )}
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              )}

              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest mb-3">
                Notifications
              </Text>
              {notifications.length === 0 && (
                <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm">
                  You're all caught up.
                </Text>
              )}
            </View>
          }
          renderItem={({ item }) => {
            const unread = !item.read_at;
            return (
              <Pressable
                onPress={() => openNotification(item)}
                style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }] })}
                className={`flex-row items-start gap-3 rounded-atp-lg px-4 py-3 mb-2 border ${unread ? 'bg-atp-green/5 border-atp-green/30' : 'bg-atp-dark border-white/5'}`}
              >
                <View className="mt-0.5">
                  <Icon name="notification" size={16} color={unread ? colors.green : colors.muted} />
                </View>
                <View className="flex-1">
                  {!!item.title && (
                    <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm" numberOfLines={2}>
                      {item.title}
                    </Text>
                  )}
                  {!!item.body && (
                    <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-xs mt-0.5" numberOfLines={3}>
                      {item.body}
                    </Text>
                  )}
                </View>
                <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-[10px]">
                  {timeAgo(item.created_at)}
                </Text>
              </Pressable>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}
