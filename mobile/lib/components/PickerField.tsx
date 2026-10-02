/**
 * PickerField + DateField — constrained inputs for Edit Profile.
 *
 * Founder report 3A (2026-10-03): date of birth, gender, nationality,
 * padel level, volleyball level and the kit sizes were all free-text
 * boxes, so members typed whatever they liked and the data was
 * unusable for matching or kit ordering.
 *
 * Deliberately pure JS. A native date picker
 * (@react-native-community/datetimepicker) would need a new binary and
 * could not ship over the air, and these screens had to reach members
 * today. The wheels below are plain ScrollViews.
 */
import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { colors, fontFamily } from '@/lib/theme/tokens';

function Label({ children }: { children: string }) {
  return (
    <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest mb-2">
      {children}
    </Text>
  );
}

function Trigger({ value, placeholder, onPress }: { value?: string | null; placeholder: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className="bg-atp-dark border border-white/10 rounded-atp px-4 py-3 flex-row items-center justify-between active:opacity-80"
    >
      <Text style={{ fontFamily: fontFamily.body, color: value ? colors.white : colors.muted }} className="text-base">
        {value || placeholder}
      </Text>
      <Text style={{ color: colors.muted }}>▾</Text>
    </Pressable>
  );
}

/** Choose one value from a list. Searchable once the list is long. */
export function PickerField({
  label, value, options, onSelect, placeholder = 'Select…', searchable,
}: {
  label: string;
  value?: string | null;
  options: string[];
  onSelect: (v: string) => void;
  placeholder?: string;
  searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const useSearch = searchable ?? options.length > 12;
  const shown = useMemo(
    () => (useSearch && q.trim() ? options.filter((o) => o.toLowerCase().includes(q.trim().toLowerCase())) : options),
    [options, q, useSearch]
  );

  return (
    <View className="mb-4">
      <Label>{label}</Label>
      <Trigger value={value} placeholder={placeholder} onPress={() => { setQ(''); setOpen(true); }} />

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <View className="flex-1" style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}>
          <View className="flex-1 mt-24 bg-atp-black rounded-t-3xl border-t border-white/10 overflow-hidden">
            <View className="px-5 pt-4 pb-3 flex-row items-center border-b border-white/5">
              <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-lg uppercase flex-1">
                {label}
              </Text>
              <Pressable onPress={() => setOpen(false)} hitSlop={10} className="px-2 py-1">
                <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-base">✕</Text>
              </Pressable>
            </View>
            {useSearch && (
              <View className="px-5 py-3">
                <TextInput
                  value={q}
                  onChangeText={setQ}
                  placeholder="Search…"
                  placeholderTextColor={colors.muted}
                  autoCorrect={false}
                  style={{ fontFamily: fontFamily.body, color: colors.white }}
                  className="bg-atp-dark border border-white/10 rounded-atp px-4 py-3 text-base"
                />
              </View>
            )}
            <FlatList
              data={shown}
              keyExtractor={(o) => o}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingHorizontal: 20, paddingTop: useSearch ? 0 : 12, paddingBottom: 40 }}
              renderItem={({ item }) => {
                const on = item === value;
                return (
                  <Pressable
                    onPress={() => { onSelect(item); setOpen(false); }}
                    className={`px-4 py-3.5 mb-1.5 rounded-atp border ${on ? 'bg-atp-green/10 border-atp-green/40' : 'bg-atp-dark border-white/5'}`}
                  >
                    <Text
                      style={{ fontFamily: on ? fontFamily.bodyBold : fontFamily.body, color: on ? colors.green : colors.white }}
                      className="text-base"
                    >
                      {item}
                    </Text>
                  </Pressable>
                );
              }}
              ListEmptyComponent={
                <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm px-1">
                  Nothing matches that search.
                </Text>
              }
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

/** Date of birth as three wheels. Stores and returns YYYY-MM-DD. */
export function DateField({
  label, value, onChange,
}: { label: string; value?: string | null; onChange: (iso: string) => void }) {
  const [open, setOpen] = useState(false);
  const thisYear = new Date().getFullYear();
  // Tuple rather than number[] so strict mode knows each part exists.
  const parsed: [number, number, number] | null = (() => {
    const mm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
    return mm ? [Number(mm[1]), Number(mm[2]), Number(mm[3])] : null;
  })();

  const [y, setY] = useState<number>(parsed ? parsed[0] : thisYear - 30);
  const [m, setM] = useState<number>(parsed ? parsed[1] : 1);
  const [d, setD] = useState<number>(parsed ? parsed[2] : 1);

  // Members must be 16+; oldest sensible bound is 100.
  const years = useMemo(() => Array.from({ length: 85 }, (_, i) => thisYear - 16 - i), [thisYear]);
  const daysInMonth = new Date(y, m, 0).getDate();
  const days = useMemo(() => Array.from({ length: daysInMonth }, (_, i) => i + 1), [daysInMonth]);

  const pretty = parsed ? `${parsed[2]} ${MONTHS[parsed[1] - 1] ?? ''} ${parsed[0]}` : null;

  function commit() {
    const safeDay = Math.min(d, new Date(y, m, 0).getDate());
    onChange(`${y}-${String(m).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`);
    setOpen(false);
  }

  const Col = ({ items, sel, onPick, w }: { items: (string | number)[]; sel: string | number; onPick: (v: any) => void; w: string }) => (
    <ScrollView className={w} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 8 }}>
      {items.map((it, i) => {
        const on = String(it) === String(sel);
        return (
          <Pressable
            key={String(it) + i}
            onPress={() => onPick(typeof items[0] === 'number' ? Number(it) : it)}
            className={`px-3 py-3 mb-1 rounded-atp ${on ? 'bg-atp-green/15' : ''}`}
          >
            <Text
              style={{ fontFamily: on ? fontFamily.bodyBold : fontFamily.body, color: on ? colors.green : colors.white }}
              className="text-base text-center"
            >
              {it}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );

  return (
    <View className="mb-4">
      <Label>{label}</Label>
      <Trigger value={pretty} placeholder="Select your date of birth" onPress={() => setOpen(true)} />

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <View className="flex-1 justify-end" style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}>
          <View className="bg-atp-black rounded-t-3xl border-t border-white/10 overflow-hidden" style={{ maxHeight: '70%' }}>
            <View className="px-5 pt-4 pb-3 flex-row items-center border-b border-white/5">
              <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-lg uppercase flex-1">
                Date of birth
              </Text>
              <Pressable onPress={() => setOpen(false)} hitSlop={10} className="px-2 py-1">
                <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-base">✕</Text>
              </Pressable>
            </View>
            <View className="flex-row px-4 py-2" style={{ height: 260 }}>
              <Col items={days} sel={d} onPick={setD} w="flex-[1]" />
              <Col items={MONTHS} sel={MONTHS[m - 1] ?? MONTHS[0]!} onPick={(v: string) => setM(MONTHS.indexOf(v) + 1)} w="flex-[2]" />
              <Col items={years} sel={y} onPick={setY} w="flex-[1.2]" />
            </View>
            <View className="px-5 pb-6 pt-2">
              <Pressable onPress={commit} className="bg-atp-green rounded-atp py-3.5 items-center active:opacity-80">
                <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.black }} className="text-sm uppercase tracking-widest">
                  Set date of birth
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
