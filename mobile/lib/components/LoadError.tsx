/**
 * Inline fetch-failure block — shared by the tab screens so a dead
 * network never renders as a happy empty state ("No sessions today"
 * when the request actually failed).
 *
 * Deliberately small: one muted line + a retry chip wired straight to
 * the owning query's refetch(). Screens keep their pull-to-refresh as
 * the second recovery path.
 */
import { Pressable, Text, View } from 'react-native';
import { colors, fontFamily } from '@/lib/theme/tokens';

export function LoadError({ onRetry, message }: { onRetry: () => void; message?: string }) {
  return (
    <View className="bg-atp-dark border border-white/5 rounded-atp p-4 items-center">
      <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm text-center">
        {message || "Couldn't load — pull to refresh"}
      </Text>
      <Pressable onPress={onRetry} className="mt-2.5 bg-atp-dark-3 border border-white/10 rounded-atp px-4 py-2 active:opacity-70">
        <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-xs uppercase tracking-widest">
          Retry
        </Text>
      </Pressable>
    </View>
  );
}
