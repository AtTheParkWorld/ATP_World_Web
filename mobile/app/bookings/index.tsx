/**
 * My bookings — every booking the member has made, split into
 * "Upcoming" and "Past" sections (backend returns the last 50,
 * newest-scheduled first).
 *
 * Rows: session name, day + time, location, status chip. Tapping any
 * row opens /sessions/[id] — for upcoming bookings that's where the
 * check-in QR lives; for attended past bookings that's where the
 * "Rate this session" block lives (the row shows a "Rate →" hint).
 *
 * Entry point: Profile tab → "My bookings" row.
 */
import { SectionList, Pressable, RefreshControl, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listMyBookings, type BookingRecord } from '@/lib/api/bookings';
import { LoadError } from '@/lib/components/LoadError';
import { colors, fontFamily } from '@/lib/theme/tokens';
import { dayHeader, timeShort } from '@/lib/utils/date';

const STATUS_LABEL: Record<string, string> = {
  confirmed:       'Confirmed',
  pending_payment: 'Pending payment',
  waitlisted:      'Waitlisted',
  attended:        'Attended',
  cancelled:       'Cancelled',
};

function statusColor(status: string): string {
  if (status === 'attended')        return colors.green;
  if (status === 'confirmed')       return colors.green;
  if (status === 'waitlisted')      return colors.warning;
  if (status === 'pending_payment') return colors.warning;
  if (status === 'cancelled')       return colors.muted;
  return colors.light;
}

export default function MyBookings() {
  const qc = useQueryClient();

  const bookingsQ = useQuery({
    queryKey: ['my-bookings'],
    queryFn:  () => listMyBookings().then(r => r.bookings),
  });

  const all: BookingRecord[] = bookingsQ.data || [];
  const now = Date.now();
  const isUpcoming = (b: BookingRecord) =>
    b.status !== 'cancelled' && !!b.scheduled_at && new Date(b.scheduled_at).getTime() > now;

  const upcoming = all.filter(isUpcoming).sort(
    (a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime()
  );
  const past = all.filter((b) => !isUpcoming(b)); // backend order: newest first

  const sections = [
    ...(upcoming.length ? [{ title: 'Upcoming', data: upcoming }] : []),
    ...(past.length     ? [{ title: 'Past',     data: past }]     : []),
  ];

  return (
    <SafeAreaView className="flex-1 bg-atp-black" edges={['top']}>
      <View className="px-5 pt-2 pb-3 flex-row items-center border-b border-white/5">
        <Pressable onPress={() => router.back()} className="py-2 -ml-2 px-2">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-lg">←</Text>
        </Pressable>
        <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-lg uppercase ml-2">
          My bookings
        </Text>
      </View>

      {bookingsQ.isError && !all.length ? (
        <View className="px-5 pt-6">
          <LoadError onRetry={() => bookingsQ.refetch()} />
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(b) => String(b.id)}
          stickySectionHeadersEnabled={false}
          renderSectionHeader={({ section }) => (
            <Text
              style={{ fontFamily: fontFamily.bodyBold, color: colors.muted, letterSpacing: 1.2 }}
              className="text-xs uppercase px-5 pt-6 pb-2"
            >
              {section.title}
            </Text>
          )}
          renderItem={({ item }) => <BookingRow booking={item} />}
          refreshControl={
            <RefreshControl
              tintColor={colors.green}
              refreshing={bookingsQ.isFetching && !bookingsQ.isLoading}
              onRefresh={() => qc.invalidateQueries({ queryKey: ['my-bookings'] })}
            />
          }
          ListEmptyComponent={
            bookingsQ.isLoading ? (
              <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="px-8 pt-12 text-sm text-center">
                Loading your bookings…
              </Text>
            ) : (
              <View className="px-8 pt-16 items-center">
                <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-2xl uppercase text-center">
                  Nothing booked yet.
                </Text>
                <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm mt-2 text-center">
                  Reserve a spot and it'll show up here with your check-in QR.
                </Text>
                <Pressable
                  onPress={() => router.push('/(tabs)/sessions')}
                  className="mt-6 bg-atp-green rounded-atp px-6 py-3.5 active:opacity-80"
                >
                  <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.black }} className="text-sm uppercase tracking-widest">
                    Find a session
                  </Text>
                </Pressable>
              </View>
            )
          }
          contentContainerStyle={{ paddingBottom: 60 }}
        />
      )}
    </SafeAreaView>
  );
}

function BookingRow({ booking }: { booking: BookingRecord }) {
  const b = booking;
  const canRate = b.status === 'attended';
  return (
    <Pressable
      onPress={() => router.push(`/sessions/${b.session_id}`)}
      className="mx-5 mb-2 bg-atp-dark border border-white/5 rounded-atp p-4 active:opacity-70"
    >
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm" numberOfLines={1}>
            {b.session_name || 'Session'}
          </Text>
          {!!b.scheduled_at && (
            <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-xs mt-1">
              {dayHeader(b.scheduled_at)} · {timeShort(b.scheduled_at)}
            </Text>
          )}
          {!!b.location && (
            <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs mt-0.5" numberOfLines={1}>
              📍 {b.location}
            </Text>
          )}
        </View>
        <View className="items-end gap-1.5">
          <View
            className="rounded-full px-2.5 py-1"
            style={{ borderWidth: 1, borderColor: `${statusColor(b.status)}55`, backgroundColor: `${statusColor(b.status)}15` }}
          >
            <Text style={{ fontFamily: fontFamily.bodyBold, color: statusColor(b.status), letterSpacing: 1 }} className="text-[10px] uppercase">
              {STATUS_LABEL[b.status] || b.status}
            </Text>
          </View>
          {canRate && (
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-xs">
              Rate →
            </Text>
          )}
        </View>
      </View>
    </Pressable>
  );
}
