/**
 * ActionSheet — bottom sheet of choices with a visible ✕.
 *
 * Replaces Alert.alert for the "⋯" / report menus (founder 2026-10-05).
 * On Android an Alert is a native AlertDialog that:
 *   · ignores the BACK button/gesture and taps outside it unless
 *     `cancelable` is passed — members felt stuck in "Member actions";
 *   · shows at most THREE buttons and silently drops the rest, so the
 *     four-button report menus lost their last reason.
 * This sheet closes on BACK (onRequestClose), on a tap on the dimmed
 * backdrop, on ✕ and on Cancel, and lists any number of actions.
 *
 * Controlled: the parent owns `visible` and decides in each action's
 * onPress whether to close or swap in the next step (e.g. "Report" →
 * reasons). Swapping content inside one Modal avoids iOS refusing to
 * present a second modal while the first is still animating away.
 */
import { Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fontFamily } from '@/lib/theme/tokens';

export interface SheetAction {
  label: string;
  onPress: () => void;
  destructive?: boolean;
}

interface Props {
  visible: boolean;
  title: string;
  message?: string;
  actions: SheetAction[];
  onClose: () => void;
}

export function ActionSheet({ visible, title, message, actions, onClose }: Props) {
  // Android draws edge-to-edge, so the sheet would sit under the
  // gesture/nav bar without the bottom inset.
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        accessibilityLabel="Close menu"
        className="flex-1 justify-end"
        style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
      >
        <Pressable onPress={(e) => e.stopPropagation()}>
          <View
            className="bg-atp-dark rounded-t-3xl border-t border-white/10 px-5 pt-4"
            style={{ paddingBottom: Math.max(insets.bottom, 12) + 12 }}
          >
            <View className="flex-row items-start">
              <View className="flex-1 pr-3">
                <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-xl uppercase tracking-tight">
                  {title}
                </Text>
                {!!message && (
                  <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm mt-1">
                    {message}
                  </Text>
                )}
              </View>
              <Pressable
                onPress={onClose}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Close"
                className="w-8 h-8 rounded-full bg-atp-dark-3 items-center justify-center active:opacity-70"
              >
                <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.light }} className="text-base">✕</Text>
              </Pressable>
            </View>

            <View className="mt-4 gap-2">
              {actions.map((a) => (
                <Pressable
                  key={a.label}
                  onPress={a.onPress}
                  accessibilityRole="button"
                  className="bg-atp-dark-3 border border-white/5 rounded-atp px-4 py-3.5 active:opacity-70"
                >
                  <Text
                    style={{ fontFamily: fontFamily.bodyBold, color: a.destructive ? colors.danger : colors.white }}
                    className="text-base"
                  >
                    {a.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Pressable onPress={onClose} className="mt-2 py-3 items-center active:opacity-70">
              <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm">
                Cancel
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
