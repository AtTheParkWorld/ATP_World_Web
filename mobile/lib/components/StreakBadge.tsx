/**
 * Streak badge — used on Home + Profile. Shape:
 *   🔥 12 day streak       (alive)
 *   ⏳ 12 day streak       (in grace window — show hours_until_grace_ends)
 *   no streak label         (count <= 0)
 *
 * Re-used on Profile to drive the achievement header.
 */
import { Text, View } from 'react-native';
import type { StreakSummary } from '@/lib/api/members';
import { colors, fontFamily } from '@/lib/theme/tokens';

interface Props {
  streak: StreakSummary | null;
  compact?: boolean;
}

export function StreakBadge({ streak, compact }: Props) {
  if (!streak || streak.current_streak <= 0) {
    return (
      <View className="bg-atp-dark rounded-full border border-white/10 px-3 py-1 self-start">
        <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-xs">
          Start a streak — book today.
        </Text>
      </View>
    );
  }

  const alive    = streak.is_alive;
  const inGrace  = !alive && streak.current_streak > 0;
  const icon     = inGrace ? '⏳' : '🔥';
  const accent   = inGrace ? colors.warning : colors.green;

  return (
    <View
      className={`rounded-full self-start flex-row items-center ${compact ? 'px-2.5 py-1' : 'px-3 py-1.5'}`}
      style={{ backgroundColor: 'rgba(168, 255, 0, 0.12)', borderWidth: 1, borderColor: accent }}
    >
      <Text style={{ fontFamily: fontFamily.bodyBold, color: accent }} className="text-xs">
        {icon} {streak.current_streak}-day streak
      </Text>
      {inGrace && streak.hours_until_grace_ends != null && (
        <Text style={{ fontFamily: fontFamily.body, color: colors.warning }} className="text-[10px] ml-2">
          {streak.hours_until_grace_ends}h to save
        </Text>
      )}
    </View>
  );
}
