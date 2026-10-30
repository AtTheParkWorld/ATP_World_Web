/**
 * Shared bits of the in-app 30x30 Fitness Hub (founder 2026-10-19):
 * one data hook (hub + challenge sessions, challenges with my entry) and
 * the empty-state card, used by app/hub30x30/*.
 */
import { Linking, Pressable, Share, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { listSessions } from '@/lib/api/sessions';
import { listHubChallenges, setHubDonation, inviteUrl, type HubChallenge, type HubTeam } from '@/lib/api/hubChallenges';
import { colors, fontFamily } from '@/lib/theme/tokens';

export function useHubData() {
  const sessionsQ = useQuery({
    queryKey: ['hub30', 'sessions'],
    queryFn: () => listSessions({ status: 'upcoming', limit: 500 }).then((r) => r.sessions),
    staleTime: 1000 * 60,
  });
  const challengesQ = useQuery({
    queryKey: ['hub30', 'challenges'],
    queryFn: () => listHubChallenges().then((r) => r.challenges),
    staleTime: 1000 * 30,
  });
  return { sessionsQ, challengesQ };
}

export function HubEmpty({ title, body }: { title: string; body: string }) {
  return (
    <View className="bg-atp-dark rounded-atp border border-white/5 p-5 mt-4 items-center">
      <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-base text-center">{title}</Text>
      <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm text-center mt-1 leading-5">{body}</Text>
    </View>
  );
}

const GREEN2 = '#22c55e';

// Free parking at DIC (founder 2026-10-30) — same copy as the landing
// page's parking highlight. Shown on the hub screen and on every 30x30
// session screen.
export function HubParking() {
  return (
    <View className="flex-row rounded-atp p-4" style={{ backgroundColor: 'rgba(249,0,0,.08)', borderWidth: 1, borderColor: 'rgba(249,0,0,.35)' }}>
      <View className="rounded-md items-center justify-center mr-3" style={{ width: 40, height: 40, backgroundColor: '#f90000' }}>
        <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-xl">P</Text>
      </View>
      <View className="flex-1">
        <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-base">Free parking at Dubai Internet City</Text>
        <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-sm mt-1 leading-5">
          Park for free in the DIC parking area. At the entrance, press the buzzer and tell security you’re taking part in 30x30. Free parking runs from 1 hour before the event until 1 hour after the sessions finish.
        </Text>
      </View>
    </View>
  );
}

export function TeamCard({ c, team }: { c: HubChallenge; team: HubTeam }) {
  const url = team.invite_url || inviteUrl(team.invite_code);
  const n = team.members || 1;
  return (
    <View className="bg-atp-dark rounded-atp border border-white/10 p-4 mt-4">
      <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-base">{team.is_captain ? '👑 ' : ''}Your team: {team.name}</Text>
      <Text style={{ fontFamily: fontFamily.body, color: n < (c.team_min || 1) ? colors.warning : colors.green }} className="text-sm mt-1">
        {n} of {c.team_max} members · {n < (c.team_min || 1) ? `needs ${(c.team_min || 1) - n} more to compete` : 'ready'}
      </Text>
      {!!team.invite_code && (
        <>
          <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs mt-3">Team code</Text>
          <Text selectable style={{ fontFamily: fontFamily.displayBlack, color: colors.white, letterSpacing: 3 }} className="text-2xl">{team.invite_code}</Text>
          <Pressable onPress={() => Share.share({ message: `Join my team "${team.name}" for the ${c.name} at the DIC 30x30 Fitness Hub 💪\n${url}\nTeam code: ${team.invite_code}` })}
            className="bg-atp-green rounded-atp py-3 items-center mt-3 active:opacity-70">
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.black }} className="text-sm">Invite teammates</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

export function CharityAsk({ c, onAnswered }: { c: HubChallenge; onAnswered: (choice: 'yes' | 'no') => void }) {
  const answer = (choice: 'yes' | 'no') => {
    setHubDonation(c.id, choice).catch(() => {});
    if (choice === 'yes' && c.charity_url) Linking.openURL(c.charity_url).catch(() => {});
    onAnswered(choice);
  };
  return (
    <View className="rounded-atp p-4 mt-4" style={{ backgroundColor: 'rgba(34,197,94,.08)', borderWidth: 1, borderColor: 'rgba(34,197,94,.35)' }}>
      <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-base">💚 Support {c.charity_name}?</Text>
      {!!c.charity_description && <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-sm mt-1 leading-5">{c.charity_description}</Text>}
      <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs mt-1">Totally optional — you donate on {c.charity_name}’s own page.</Text>
      <View className="flex-row gap-2 mt-3">
        <Pressable onPress={() => answer('yes')} className="flex-1 rounded-atp py-3 items-center active:opacity-70" style={{ backgroundColor: GREEN2 }}>
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm">Donate ↗</Text>
        </Pressable>
        <Pressable onPress={() => answer('no')} className="flex-1 rounded-atp py-3 items-center border border-white/20 active:opacity-70">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm">Not now</Text>
        </Pressable>
      </View>
    </View>
  );
}
