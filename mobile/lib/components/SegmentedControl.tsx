/**
 * Simple iOS-style segmented control. Used by the Community tab to
 * switch between Feed / Coaches / Friends without burning a new screen.
 *
 * Style mirrors the web's nav-segment buttons — green-on-black active,
 * neutral inactive.
 */
import { Pressable, Text, View } from 'react-native';
import { colors, fontFamily } from '@/lib/theme/tokens';

interface Props<T extends string> {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}

export function SegmentedControl<T extends string>({ value, options, onChange }: Props<T>) {
  return (
    <View className="flex-row bg-atp-dark rounded-atp border border-white/5 p-1">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            className={`flex-1 rounded-md py-2.5 items-center ${active ? 'bg-atp-green' : ''}`}
          >
            <Text
              style={{
                fontFamily: fontFamily.bodyBold,
                color: active ? colors.black : colors.light,
              }}
              className="text-xs uppercase tracking-widest"
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
