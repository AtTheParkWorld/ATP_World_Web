/**
 * Global leaderboard. Top-50 members ranked by points earned in the
 * selected window. Filters: time period (MTD / YTD / All-time), city,
 * tribe. Optimised for "where am I in the pack" — viewer's own row
 * highlighted in green when present.
 */
import { useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getLeaderboard, type LeaderboardRow } from '@/lib/api/leaderboard';
import { listCities, listTribes } from '@/lib/api/sessions';
import { useAuthStore } from '@/lib/stores/auth.store';
import { colors, fontFamily, tribeColor } from '@/lib/theme/tokens';
import { absUrl } from '@/lib/utils/imageUrl';

type Period = 'mtd' | 'ytd' | 'all-time';

export default function Leaderboard() {
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.member) as any;
  const [period,  setPeriod]   = useState<Period>('mtd');
  const [cityId,  setCityId]   = useState<string | null>(null);
  const [tribeId, setTribeId]  = useState<string | null>(null);

  const lbQ = useQuery({
    queryKey: ['leaderboard', period, cityId, tribeId],
    queryFn:  () => getLeaderboard({
      period,
      city_id:  cityId ?? undefined,
      tribe_id: tribeId ?? undefined,
    }).then(r => r.leaderboard),
  });
  const citiesQ = useQuery({ queryKey: ['cities'], queryFn: () => listCities().then(r => r.cities), staleTime: 1000 * 60 * 30 });
  const tribesQ = useQuery({ queryKey: ['tribes'], queryFn: () => listTribes().then(r => r.tribes), staleTime: 1000 * 60 * 30 });

  return (
    <SafeAreaView className="flex-1 bg-atp-black" edges={['top']}>
      <View className="px-5 pt-2 pb-3 flex-row items-center border-b border-white/5">
        <Pressable onPress={() => router.back()} className="py-2 -ml-2 px-2">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-lg">←</Text>
        </Pressable>
        <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-lg uppercase ml-2">
          Leaderboard
        </Text>
      </View>

      {/* Period segment */}
      <View className="px-5 pt-3">
        <View className="flex-row bg-atp-dark rounded-atp border border-white/5 p-1">
          {([['mtd', 'This month'], ['ytd', 'This year'], ['all-time', 'All time']] as const).map(([k, label]) => (
            <Pressable
              key={k}
              onPress={() => setPeriod(k)}
              className={`flex-1 rounded-md py-2 items-center ${period === k ? 'bg-atp-green' : ''}`}
            >
              <Text
                style={{ fontFamily: fontFamily.bodyBold, color: period === k ? colors.black : colors.light }}
                className="text-xs uppercase tracking-widest"
              >
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* City + tribe pill rails */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-3" contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
        <FilterChip label="All cities" active={!cityId} onPress={() => setCityId(null)} />
        {(citiesQ.data || []).map((c) => (
          <FilterChip key={c.id} label={c.name} active={cityId === c.id} onPress={() => setCityId(c.id)} />
        ))}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-2 mb-3" contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
        <FilterChip label="All tribes" active={!tribeId} onPress={() => setTribeId(null)} />
        {(tribesQ.data || []).map((t) => (
          <FilterChip
            key={t.id}
            label={t.name}
            active={tribeId === t.id}
            onPress={() => setTribeId(t.id)}
            accent={tribeColor(t.slug)}
          />
        ))}
      </ScrollView>

      {/* List */}
      <FlatList
        data={lbQ.data || []}
        keyExtractor={(r) => r.id}
        renderItem={({ item, index }) => (
          <LeaderboardRow row={item} rank={index + 1} isMe={me?.id === item.id} />
        )}
        refreshControl={
          <RefreshControl
            tintColor={colors.green}
            refreshing={lbQ.isFetching && !lbQ.isLoading}
            onRefresh={() => qc.invalidateQueries({ queryKey: ['leaderboard'] })}
          />
        }
        ListEmptyComponent={
          <View className="px-8 pt-12 items-center">
            {lbQ.isLoading
              ? <ActivityIndicator color={colors.green} />
              : <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm text-center">
                  No one has earned points in this window yet.
                </Text>}
          </View>
        }
        contentContainerStyle={{ paddingTop: 4, paddingBottom: 40 }}
      />
    </SafeAreaView>
  );
}

function FilterChip({ label, active, onPress, accent }: { label: string; active: boolean; onPress: () => void; accent?: string }) {
  return (
    <Pressable
      onPress={onPress}
      className={`rounded-full px-3 py-1.5 border ${active ? '' : 'bg-atp-dark border-white/10'}`}
      style={active ? { backgroundColor: accent || colors.green, borderColor: accent || colors.green, borderWidth: 1 } : undefined}
    >
      <Text
        style={{ fontFamily: fontFamily.bodyBold, color: active ? colors.black : colors.white }}
        className="text-xs uppercase tracking-widest"
      >
        {label}
      </Text>
    </Pressable>
  );
}

function LeaderboardRow({ row, rank, isMe }: { row: LeaderboardRow; rank: number; isMe: boolean }) {
  const tColor = tribeColor(row.tribe_slug);
  const pts = Number(row.period_points) || 0;
  return (
    <Pressable
      onPress={() => router.push(`/community/members/${row.id}`)}
      className={`mx-5 mb-2 rounded-atp p-3 flex-row items-center gap-3 active:opacity-70 ${isMe ? 'bg-atp-green/15 border border-atp-green/40' : 'bg-atp-dark border border-white/5'}`}
    >
      <Text
        style={{ fontFamily: fontFamily.displayBlack, color: rank <= 3 ? colors.green : isMe ? colors.green : colors.muted }}
        className="text-lg w-8"
      >
        #{rank}
      </Text>
      <View
        className="w-10 h-10 rounded-full bg-atp-dark-3 items-center justify-center overflow-hidden"
        style={{ borderWidth: 1, borderColor: tColor }}
      >
        {row.avatar_url
          ? <Image source={{ uri: absUrl(row.avatar_url)! }} className="w-10 h-10" />
          : <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }}>{row.first_name[0]}</Text>}
      </View>
      <View className="flex-1">
        <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm">
          {row.first_name} {row.last_name}{isMe ? ' (you)' : ''}
        </Text>
        <View className="flex-row items-center gap-2 mt-0.5">
          {!!row.tribe_name && (
            <Text style={{ fontFamily: fontFamily.bodyBold, color: tColor }} className="text-[10px] uppercase tracking-widest">
              {row.tribe_name}
            </Text>
          )}
          {!!row.city_name && (
            <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs">
              · 📍 {row.city_name}
            </Text>
          )}
          {row.current_streak > 0 && (
            <Text style={{ fontFamily: fontFamily.body, color: colors.green }} className="text-xs">
              · 🔥 {row.current_streak}
            </Text>
          )}
        </View>
      </View>
      <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.green }} className="text-base">
        {pts.toLocaleString()}
      </Text>
    </Pressable>
  );
}
