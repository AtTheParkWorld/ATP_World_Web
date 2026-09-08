/**
 * CourtPicker — team-sports court board (founder 2026-08-30).
 *
 * Three jobs on one screen:
 *   1. pick which court you're playing on before you book
 *   2. see the levels each court allows (a court can allow several)
 *   3. see who is already on each court, and at what level
 *
 * Level matching is INFORMATIVE, not a barrier: a court you don't match
 * is marked but still bookable, because a hard block would strand
 * members with no level recorded and turn every mixed game into a
 * support request. A FULL court is a real block — those can't be joined.
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { getSessionCourts, type SessionCourt } from '@/lib/api/sessions';
import { Avatar } from '@/lib/components/Avatar';
import { colors, fontFamily } from '@/lib/theme/tokens';

function LevelChips({ levels, muted }: { levels: string[]; muted?: boolean }) {
  if (!levels.length) {
    return (
      <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-[11px]">
        All levels welcome
      </Text>
    );
  }
  return (
    <View className="flex-row flex-wrap gap-1.5">
      {levels.map((l) => (
        <Text
          key={l}
          style={{ fontFamily: fontFamily.bodyBold, color: muted ? colors.muted : colors.green }}
          className={`text-[10px] uppercase tracking-wider border rounded-full px-2 py-0.5 ${
            muted ? 'border-white/15' : 'border-atp-green/40'
          }`}
        >
          {l}
        </Text>
      ))}
    </View>
  );
}

function CourtCard({
  court,
  selected,
  isMine,
  onSelect,
}: {
  court: SessionCourt;
  selected: boolean;
  isMine: boolean;
  onSelect: () => void;
}) {
  const [showPlayers, setShowPlayers] = useState(false);
  const disabled = court.is_full && !isMine;

  return (
    <View
      className={`border rounded-atp-lg mb-2.5 overflow-hidden ${
        selected ? 'border-atp-green bg-atp-green/10' : 'border-white/10 bg-atp-dark'
      }`}
    >
      <Pressable
        onPress={disabled ? undefined : onSelect}
        disabled={disabled}
        className="px-4 py-3"
        style={{ opacity: disabled ? 0.45 : 1 }}
      >
        <View className="flex-row items-start">
          <View className="flex-1">
            <View className="flex-row items-center gap-2">
              <Text
                style={{ fontFamily: fontFamily.displayBlack, color: colors.white }}
                className="text-base uppercase tracking-tight"
              >
                {court.name}
              </Text>
              {isMine && (
                <Text
                  style={{ fontFamily: fontFamily.bodyBold, color: colors.green }}
                  className="text-[9px] uppercase tracking-widest border border-atp-green/40 rounded-full px-2 py-0.5"
                >
                  You're here
                </Text>
              )}
              {court.is_full && !isMine && (
                <Text
                  style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }}
                  className="text-[9px] uppercase tracking-widest border border-white/15 rounded-full px-2 py-0.5"
                >
                  Full
                </Text>
              )}
            </View>
            <View className="mt-1.5">
              <LevelChips levels={court.levels} muted={!court.matches_my_level} />
            </View>
            {!court.matches_my_level && court.levels.length > 0 && (
              <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-[11px] mt-1.5">
                Different level to yours — you can still join
              </Text>
            )}
          </View>

          <View className="items-end ml-3">
            <Text
              style={{ fontFamily: fontFamily.displayBlack, color: court.is_full ? colors.muted : colors.green }}
              className="text-lg"
            >
              {court.booked_count}/{court.max_players}
            </Text>
            <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-[10px] uppercase tracking-wider">
              players
            </Text>
          </View>
        </View>
      </Pressable>

      {court.players.length > 0 && (
        <Pressable
          onPress={() => setShowPlayers((v) => !v)}
          className="px-4 pb-3 pt-1 border-t border-white/5 active:opacity-70"
        >
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-[11px] uppercase tracking-widest">
            {showPlayers ? 'Hide players' : `See who's playing (${court.players.length})`}
          </Text>
        </Pressable>
      )}

      {showPlayers && (
        <View className="px-4 pb-3 gap-2">
          {court.players.map((p) => (
            <View key={p.id} className="flex-row items-center">
              <Avatar
                uri={p.avatar_url}
                firstName={p.first_name ?? undefined}
                lastName={p.last_name ?? undefined}
                id={p.id}
                size="sm"
              />
              <Text
                style={{ fontFamily: fontFamily.body, color: colors.white }}
                className="text-sm ml-2.5 flex-1"
                numberOfLines={1}
              >
                {`${p.first_name || ''} ${p.last_name || ''}`.trim() || 'ATP member'}
              </Text>
              {!!p.level && (
                <Text
                  style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }}
                  className="text-[10px] uppercase tracking-wider border border-white/12 rounded-full px-2 py-0.5"
                >
                  {p.level}
                </Text>
              )}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

export function CourtPicker({
  sessionId,
  value,
  onChange,
  onCourtCount,
}: {
  sessionId: string;
  /** Currently picked court name, or null. */
  value: string | null;
  onChange: (courtName: string | null) => void;
  /** How many courts this session defines — 0 means the session runs
   *  without courts, so the screen shouldn't demand one. */
  onCourtCount?: (n: number) => void;
}) {
  const q = useQuery({
    queryKey: ['session-courts', sessionId],
    queryFn: () => getSessionCourts(sessionId),
    staleTime: 30 * 1000,
  });

  const loadedCount = q.data?.courts?.length;
  useEffect(() => {
    if (loadedCount !== undefined && onCourtCount) onCourtCount(loadedCount);
  }, [loadedCount, onCourtCount]);

  if (q.isLoading) {
    return <ActivityIndicator color={colors.green} className="my-4" />;
  }
  if (q.isError) {
    return (
      <View className="bg-atp-dark border border-white/10 rounded-atp p-4 mb-3">
        <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm">
          Couldn't load the courts.
        </Text>
        <Pressable onPress={() => q.refetch()} className="mt-2">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-xs uppercase tracking-widest">
            Try again
          </Text>
        </Pressable>
      </View>
    );
  }

  const courts = q.data?.courts || [];
  if (!courts.length) return null;

  const myLevel = q.data?.my_level;
  const myCourt = q.data?.my_court;

  return (
    <View className="mb-4">
      <View className="flex-row items-center justify-between mb-2">
        <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-xs uppercase tracking-widest">
          Pick your court
        </Text>
        {!!myLevel && (
          <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-[11px]">
            Your level: <Text style={{ color: colors.green }}>{myLevel}</Text>
          </Text>
        )}
      </View>

      {courts.map((c) => (
        <CourtCard
          key={`${c.court_number}-${c.name}`}
          court={c}
          selected={value === c.name}
          isMine={myCourt === c.name}
          onSelect={() => onChange(value === c.name ? null : c.name)}
        />
      ))}

      {!myLevel && (
        <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-[11px] mt-1">
          Set your level in Edit Profile and we'll highlight the courts that fit you.
        </Text>
      )}
    </View>
  );
}
