/**
 * MyNextSession — the member's upcoming bookings as a swipeable
 * carousel (founder 2026-09-05: "show ALL my booked sessions on
 * carousel, from the closest upcoming to the furthest"). Shared by
 * Home and Profile.
 *
 * One booking renders exactly like the old single card; more than one
 * becomes a horizontal snap carousel ordered soonest-first, with a
 * count in the header and dots underneath. Owns its own
 * ['my-bookings'] query so both screens stay in sync via the React
 * Query cache. Tapping a card deep-links to /sessions/[id]; with
 * nothing booked it points to the Sessions tab.
 */
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { listMyBookings, type BookingRecord } from '@/lib/api/bookings';
import { colors, fontFamily } from '@/lib/theme/tokens';

function BookingCard({ b, width }: { b: BookingRecord; width: number }) {
  return (
    <Pressable
      onPress={() => router.push(`/sessions/${b.session_id}`)}
      style={{ width }}
      className="bg-atp-dark rounded-atp-lg border border-white/5 p-5 active:opacity-70"
    >
      <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-xs uppercase tracking-widest mb-1">
        {b.tribe_name || b.city_name || 'Booked'}
      </Text>
      <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-2xl uppercase tracking-tight" numberOfLines={2}>
        {b.session_name}
      </Text>
      <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-sm mt-2">
        {b.scheduled_at && new Date(b.scheduled_at).toLocaleString()}
      </Text>
      {!!b.location && (
        <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs mt-1" numberOfLines={1}>
          📍 {b.location}
        </Text>
      )}
      {!!b.qr_token && (
        <View className="mt-3 self-start bg-atp-green/15 border border-atp-green/40 px-3 py-1.5 rounded-full">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-xs uppercase tracking-widest">
            Tap to show QR
          </Text>
        </View>
      )}
    </Pressable>
  );
}

export function MyNextSession() {
  const bookingsQ = useQuery({ queryKey: ['my-bookings'], queryFn: () => listMyBookings().then(r => r.bookings) });
  const { width } = useWindowDimensions();
  const [page, setPage] = useState(0);

  // All non-cancelled future bookings, soonest first — sort, don't
  // trust API order.
  const upcoming = (bookingsQ.data || [])
    .filter((b: BookingRecord) => b.status !== 'cancelled' && b.scheduled_at && new Date(b.scheduled_at).getTime() > Date.now())
    .sort((a: BookingRecord, b: BookingRecord) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime());

  // Screens render this inside px-5 padding → card width = screen - 40.
  // With several cards, trim a peek strip so the next card's edge shows
  // and invites the swipe.
  const cardWidth = width - 40 - (upcoming.length > 1 ? 28 : 0);
  const GAP = 10;

  return (
    <View>
      <View className="flex-row items-center justify-between mb-3">
        <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest">
          {upcoming.length > 1 ? `My Sessions (${upcoming.length})` : 'My Next Session'}
        </Text>
        {upcoming.length > 1 && (
          <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-[10px] uppercase tracking-wider">
            swipe →
          </Text>
        )}
      </View>
      {bookingsQ.isLoading ? (
        <ActivityIndicator color={colors.green} />
      ) : upcoming.length > 0 ? (
        <View>
          <FlatList
            horizontal
            data={upcoming}
            keyExtractor={(b) => String(b.id)}
            showsHorizontalScrollIndicator={false}
            snapToInterval={cardWidth + GAP}
            snapToAlignment="start"
            decelerationRate="fast"
            ItemSeparatorComponent={() => <View style={{ width: GAP }} />}
            renderItem={({ item }) => <BookingCard b={item} width={cardWidth} />}
            onMomentumScrollEnd={(e) => {
              const p = Math.round(e.nativeEvent.contentOffset.x / (cardWidth + GAP));
              setPage(Math.max(0, Math.min(p, upcoming.length - 1)));
            }}
            // Home/Profile wrap this in px-5 — let the strip bleed to the
            // right edge so the peeked next card reads naturally.
            style={{ marginRight: -20 }}
            contentContainerStyle={{ paddingRight: 20 }}
          />
          {upcoming.length > 1 && (
            <View className="flex-row justify-center gap-1.5 mt-3">
              {upcoming.map((b, i) => (
                <View
                  key={String(b.id)}
                  className="rounded-full"
                  style={{
                    width: i === page ? 16 : 6,
                    height: 6,
                    backgroundColor: i === page ? colors.green : 'rgba(255,255,255,0.18)',
                  }}
                />
              ))}
            </View>
          )}
        </View>
      ) : (
        <Pressable
          onPress={() => router.push('/(tabs)/sessions')}
          className="bg-atp-dark rounded-atp-lg border border-dashed border-white/10 p-5 active:opacity-70"
        >
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-sm uppercase tracking-widest">
            Nothing booked yet
          </Text>
          <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-sm mt-1">
            Hit BOOK A SESSION to grab your spot →
          </Text>
        </Pressable>
      )}
    </View>
  );
}
