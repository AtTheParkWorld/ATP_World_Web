/**
 * Horizontal pill row used for Sessions filters and any other
 * "pick one of N" UI. Tap a pill to select it, tap the active pill to
 * clear. Stays inside a ScrollView so the rail scrolls horizontally
 * if the option list overflows.
 */
import { Pressable, ScrollView, Text } from 'react-native';
import { colors, fontFamily } from '@/lib/theme/tokens';

export interface PillOption<T extends string | number> {
  value: T;
  label: string;
}

interface Props<T extends string | number> {
  options: PillOption<T>[];
  value: T | null;
  onChange: (value: T | null) => void;
  allLabel?: string;
}

export function FilterPills<T extends string | number>({ options, value, onChange, allLabel = 'All' }: Props<T>) {
  const items = [{ value: null, label: allLabel }, ...options.map((o) => ({ value: o.value, label: o.label }))];
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8, paddingHorizontal: 4 }}
    >
      {items.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={String(opt.value ?? '__all')}
            onPress={() => onChange(active ? null : (opt.value as T | null))}
            className={`rounded-full px-4 py-2 border ${active ? 'bg-atp-green border-atp-green' : 'bg-atp-dark border-white/10'}`}
          >
            <Text
              style={{
                fontFamily: fontFamily.bodyBold,
                color: active ? colors.black : colors.white,
              }}
              className="text-xs uppercase tracking-widest"
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
