/**
 * My Crew — everyone who joined ATP with your referral code (founder
 * 2026-08-28: existed on the website, "does not reflect anywhere" in
 * the app). Mirrors the web profile's My Crew tab: crew list with
 * per-member sessions + points earned from them, plus the share-code
 * CTA so an empty crew has an obvious next step.
 */
import { useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, Share, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getReferrals, joinCrew, type CrewMember, type MyReferrer } from '@/lib/api/members';
import { WEB_BASE } from '@/lib/api/client';
import { useAuthStore } from '@/lib/stores/auth.store';
import { Avatar } from '@/lib/components/Avatar';
import { Icon } from '@/lib/components/icons';
import { colors, fontFamily } from '@/lib/theme/tokens';

function shareInvite(code?: string | null) {
  const url = `${WEB_BASE}/join?ref=${encodeURIComponent(code || '')}`;
  Share.share({ message: `Train with me at ATP — sessions are free. Join with my code: ${url}` });
}

function CrewRow({ c }: { c: CrewMember }) {
  const name = `${c.first_name || ''} ${c.last_name || ''}`.trim() || 'ATP member';
  const sessions = Number(c.sessions_count) || 0;
  const points = Number(c.points_from_member) || 0;
  const joined = new Date(c.created_at);
  const isPremium = (c.subscription_type || '').toLowerCase() === 'premium';
  return (
    <View className="flex-row items-center bg-atp-dark border border-white/5 rounded-atp-lg px-4 py-3 mb-2">
      <Avatar uri={c.avatar_url} firstName={c.first_name ?? undefined} lastName={c.last_name ?? undefined} id={c.member_id} size="md" />
      <View className="flex-1 ml-3">
        <View className="flex-row items-center gap-2">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm" numberOfLines={1}>
            {name}
          </Text>
          {isPremium && (
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-[9px] uppercase tracking-widest border border-atp-green/40 rounded-full px-2 py-0.5">
              Premium
            </Text>
          )}
        </View>
        <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs mt-0.5">
          {sessions} session{sessions === 1 ? '' : 's'} · joined {joined.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}
        </Text>
      </View>
      <View className="items-end">
        <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.green }} className="text-base">
          +{points}
        </Text>
        <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-[10px] uppercase tracking-wider">
          pts from them
        </Text>
      </View>
    </View>
  );
}

/** Founder 2026-08-30: existing members can join someone's crew by
 *  entering that member's code. One crew forever — once you're in one
 *  this card collapses into a "you're in X's crew" chip. */
function JoinCrewCard({ myReferrer, onJoined }: { myReferrer: MyReferrer | null | undefined; onJoined: () => void }) {
  const [code, setCode] = useState('');
  const joinMu = useMutation({
    mutationFn: (c: string) => joinCrew(c),
    onSuccess: (r) => {
      const who = `${r.referrer.first_name || ''} ${r.referrer.last_name || ''}`.trim() || 'their';
      Alert.alert('Welcome to the crew! 🎉', `You joined ${who}'s crew.`);
      setCode('');
      onJoined();
    },
    onError: (e: any) => {
      Alert.alert("Couldn't join", e?.message || 'Something went wrong — try again.');
    },
  });

  if (myReferrer) {
    const who = `${myReferrer.first_name || ''} ${myReferrer.last_name || ''}`.trim() || 'ATP member';
    return (
      <View className="flex-row items-center bg-atp-dark border border-white/10 rounded-atp-lg px-4 py-3 mb-5">
        <Avatar uri={myReferrer.avatar_url} firstName={myReferrer.first_name ?? undefined} lastName={myReferrer.last_name ?? undefined} id={myReferrer.id} size="sm" />
        <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-sm ml-3 flex-1">
          You're in <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }}>{who}'s</Text> crew
        </Text>
        <Icon name="check" size={16} color={colors.green} />
      </View>
    );
  }

  return (
    <View className="bg-atp-dark border border-white/10 rounded-atp-lg p-4 mb-5">
      <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-xs uppercase tracking-widest">
        In someone's crew?
      </Text>
      <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs mt-1">
        Enter their referral code to join. Heads up — crews are forever, no switching later.
      </Text>
      <View className="flex-row items-center gap-2 mt-3">
        <TextInput
          value={code}
          onChangeText={setCode}
          placeholder="e.g. fredy-a7k"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          style={{ fontFamily: fontFamily.body, color: colors.white }}
          className="flex-1 bg-atp-black border border-white/10 rounded-atp px-3 py-2.5 text-sm"
        />
        <Pressable
          disabled={!code.trim() || joinMu.isPending}
          onPress={() => joinMu.mutate(code.trim())}
          className={`rounded-atp px-4 py-2.5 ${code.trim() ? 'bg-atp-green' : 'bg-white/10'}`}
        >
          {joinMu.isPending ? (
            <ActivityIndicator size="small" color={colors.black} />
          ) : (
            <Text style={{ fontFamily: fontFamily.bodyBold, color: code.trim() ? colors.black : colors.muted }} className="text-xs uppercase tracking-widest">
              Join
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

export default function Crew() {
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.member) as any;
  const code = me?.referral_code || me?.member_number;

  const crewQ = useQuery({ queryKey: ['crew'], queryFn: getReferrals });
  const crew = crewQ.data?.referrals || [];
  const myReferrer = crewQ.data?.my_referrer;
  const totalPts = crew.reduce((sum, c) => sum + (Number(c.points_from_member) || 0), 0);

  return (
    <SafeAreaView className="flex-1 bg-atp-black" edges={['top']}>
      <View className="px-5 pt-2 pb-3 flex-row items-center border-b border-white/5">
        <Pressable onPress={() => router.back()} className="py-2 -ml-2 px-2">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-lg">←</Text>
        </Pressable>
        <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-lg uppercase ml-2">
          My Crew
        </Text>
        {crew.length > 0 && (
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-xs ml-auto uppercase tracking-widest">
            {crew.length} member{crew.length === 1 ? '' : 's'} · +{totalPts} pts
          </Text>
        )}
      </View>

      <FlatList
        data={crew}
        keyExtractor={(c) => String(c.id)}
        contentContainerStyle={{ padding: 20, paddingBottom: 60 }}
        refreshControl={
          <RefreshControl
            tintColor={colors.green}
            refreshing={crewQ.isFetching}
            onRefresh={() => qc.invalidateQueries({ queryKey: ['crew'] })}
          />
        }
        ListHeaderComponent={
          <Pressable
            onPress={() => shareInvite(code)}
            style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.96 : 1 }] })}
            className="bg-atp-green/10 border border-atp-green/40 rounded-atp-lg p-4 mb-5 active:opacity-80"
          >
            <View className="flex-row items-center gap-3">
              <Icon name="users" size={20} color={colors.green} />
              <View className="flex-1">
                <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-xs uppercase tracking-widest">
                  Your code: {code || '—'}
                </Text>
                <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-sm mt-1">
                  Share it — earn points every time your crew checks in.
                </Text>
              </View>
              <Icon name="share" size={18} color={colors.green} />
            </View>
          </Pressable>
        }
        ListFooterComponent={
          <JoinCrewCard myReferrer={myReferrer} onJoined={() => qc.invalidateQueries({ queryKey: ['crew'] })} />
        }
        ListEmptyComponent={
          crewQ.isLoading ? (
            <ActivityIndicator color={colors.green} className="mt-10" />
          ) : (
            <View className="items-center mt-10 px-6">
              <Icon name="users" size={34} color={colors.muted} />
              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-base mt-4 text-center uppercase tracking-wide">
                No crew yet
              </Text>
              <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm mt-2 text-center">
                Friends who join ATP with your code show up here — and you earn points whenever they train.
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => <CrewRow c={item} />}
      />
    </SafeAreaView>
  );
}
