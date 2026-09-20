/**
 * My Offerings — full management in the app (founder 2026-09-21).
 *
 * This screen used to list offerings read-only and push the coach to
 * "Edit on web". Everything the web hub can do now happens here:
 * create, edit, price, duration, activate/pause, reorder by deleting
 * and re-adding, and the weekly availability windows.
 *
 * Server rules mirrored in the UI so a coach can't submit something the
 * API will reject: duration is one of 30/45/60/90, price is AED 50-500.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform,
  Pressable, ScrollView, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listMyOfferings, createOffering, updateOffering, deleteOffering,
  getMyAvailability, saveMyAvailability,
  OFFERING_DURATIONS, OFFERING_PRICE_MIN, OFFERING_PRICE_MAX,
  type CoachOffering,
} from '@/lib/api/coach';
import { colors, fontFamily } from '@/lib/theme/tokens';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Server may hand back "09:00:00"; the editor works in "09:00". */
const hhmm = (t: string) => String(t || '').slice(0, 5);

function Field({
  label, value, onChange, placeholder, keyboardType, multiline, hint,
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; keyboardType?: any; multiline?: boolean; hint?: string;
}) {
  return (
    <View className="mb-4">
      <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest mb-2">
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        keyboardType={keyboardType}
        multiline={multiline}
        style={{ fontFamily: fontFamily.body, color: colors.white, minHeight: multiline ? 84 : undefined }}
        className="bg-atp-dark border border-white/10 rounded-atp px-4 py-3 text-base"
        textAlignVertical={multiline ? 'top' : 'center'}
      />
      {!!hint && (
        <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-[11px] mt-1.5">
          {hint}
        </Text>
      )}
    </View>
  );
}

function OfferingEditor({
  offering, onClose,
}: { offering: CoachOffering | 'new' | null; onClose: () => void }) {
  const qc = useQueryClient();
  const existing = offering && offering !== 'new' ? offering : null;

  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [duration, setDuration] = useState(60);
  const [price, setPrice] = useState('');
  const [active, setActive] = useState(true);

  useEffect(() => {
    setTitle(existing?.title ?? '');
    setDesc(existing?.description ?? '');
    setDuration(Number(existing?.duration_min) || 60);
    setPrice(existing ? String(Number(existing.price_aed) || '') : '');
    setActive(existing ? existing.is_active !== false : true);
  }, [offering]);

  const priceNum = Number(price);
  const priceOk = Number.isFinite(priceNum) && priceNum >= OFFERING_PRICE_MIN && priceNum <= OFFERING_PRICE_MAX;
  const canSave = title.trim().length > 1 && priceOk;

  const saveMu = useMutation({
    mutationFn: async () => {
      const payload = {
        title: title.trim(),
        description: desc.trim() || null,
        duration_min: duration,
        price_aed: priceNum,
        is_active: active,
      };
      return existing ? updateOffering(existing.id, payload) : createOffering(payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-offerings'] });
      onClose();
    },
    onError: (e: any) => Alert.alert("Couldn't save", e?.message || 'Try again.'),
  });

  const delMu = useMutation({
    mutationFn: () => deleteOffering(existing!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-offerings'] });
      onClose();
    },
    onError: (e: any) => Alert.alert("Couldn't delete", e?.message || 'Try again.'),
  });

  if (!offering) return null;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
        <Pressable onPress={onClose} className="flex-1 bg-black/75 justify-end">
          <Pressable onPress={(e) => e.stopPropagation()}>
            <View className="bg-atp-black rounded-t-3xl border-t border-white/10 pt-3" style={{ maxHeight: '92%' }}>
              <View className="self-center w-12 h-1 bg-white/20 rounded-full mb-4" />
              <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 28 }}>
                <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-2xl uppercase tracking-tight mb-5">
                  {existing ? 'Edit offering' : 'New offering'}
                </Text>

                <Field
                  label="Title" value={title} onChange={setTitle}
                  placeholder="e.g. 1-on-1 Padel Coaching"
                />
                <Field
                  label="Description" value={desc} onChange={setDesc} multiline
                  placeholder="What a member gets in this session."
                />

                <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest mb-2">
                  Duration
                </Text>
                <View className="flex-row gap-2 mb-4">
                  {OFFERING_DURATIONS.map((d) => (
                    <Pressable
                      key={d}
                      onPress={() => setDuration(d)}
                      className={`flex-1 rounded-atp py-3 items-center border ${
                        duration === d ? 'bg-atp-green/15 border-atp-green' : 'bg-atp-dark border-white/10'
                      }`}
                    >
                      <Text
                        style={{ fontFamily: fontFamily.bodyBold, color: duration === d ? colors.green : colors.light }}
                        className="text-sm"
                      >
                        {d} min
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <Field
                  label="Price (AED)" value={price} onChange={setPrice}
                  keyboardType="number-pad" placeholder="250"
                  hint={`Between AED ${OFFERING_PRICE_MIN} and AED ${OFFERING_PRICE_MAX}.`}
                />
                {!!price && !priceOk && (
                  <Text style={{ fontFamily: fontFamily.body, color: colors.danger }} className="text-xs -mt-2 mb-3">
                    Price must be between {OFFERING_PRICE_MIN} and {OFFERING_PRICE_MAX}.
                  </Text>
                )}

                <Pressable
                  onPress={() => setActive((v) => !v)}
                  className="flex-row items-center justify-between bg-atp-dark border border-white/10 rounded-atp px-4 py-3.5 mb-5"
                >
                  <View className="flex-1 pr-3">
                    <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm">
                      {active ? 'Bookable' : 'Paused'}
                    </Text>
                    <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-[11px] mt-0.5">
                      {active ? 'Members can book this now.' : 'Hidden from your profile until you switch it back on.'}
                    </Text>
                  </View>
                  <View
                    className="w-12 h-7 rounded-full justify-center px-1"
                    style={{ backgroundColor: active ? colors.green : 'rgba(255,255,255,0.15)' }}
                  >
                    <View
                      className="w-5 h-5 rounded-full bg-atp-black"
                      style={{ alignSelf: active ? 'flex-end' : 'flex-start' }}
                    />
                  </View>
                </Pressable>

                <Pressable
                  onPress={() => saveMu.mutate()}
                  disabled={!canSave || saveMu.isPending}
                  className={`rounded-atp py-4 items-center ${canSave && !saveMu.isPending ? 'bg-atp-green active:opacity-80' : 'bg-atp-dark-3'}`}
                >
                  <Text
                    style={{ fontFamily: fontFamily.bodyBold, color: canSave && !saveMu.isPending ? colors.black : colors.muted }}
                    className="text-sm uppercase tracking-widest"
                  >
                    {saveMu.isPending ? 'Saving…' : existing ? 'Save changes' : 'Create offering'}
                  </Text>
                </Pressable>

                {!!existing && (
                  <Pressable
                    onPress={() =>
                      Alert.alert(
                        'Delete offering?',
                        `"${existing.title}" will be removed from your profile. Existing bookings are not affected.`,
                        [
                          { text: 'Keep it', style: 'cancel' },
                          { text: 'Delete', style: 'destructive', onPress: () => delMu.mutate() },
                        ],
                      )
                    }
                    className="py-4 items-center mt-1"
                  >
                    <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.danger }} className="text-xs uppercase tracking-widest">
                      {delMu.isPending ? 'Deleting…' : 'Delete offering'}
                    </Text>
                  </Pressable>
                )}

                <Pressable onPress={onClose} className="py-3 items-center">
                  <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs uppercase tracking-widest">
                    Cancel
                  </Text>
                </Pressable>
              </ScrollView>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function AvailabilityEditor({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['my-availability'], queryFn: getMyAvailability });
  const [windows, setWindows] = useState<Array<{ day_of_week: number; start_time: string; end_time: string }>>([]);

  useEffect(() => {
    if (!q.data) return;
    setWindows(
      (q.data.availability || []).map((w) => ({
        day_of_week: Number(w.day_of_week),
        start_time: hhmm(w.start_time),
        end_time: hhmm(w.end_time),
      })),
    );
  }, [q.data]);

  const saveMu = useMutation({
    mutationFn: () => saveMyAvailability(windows),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-availability'] });
      onClose();
    },
    onError: (e: any) => Alert.alert("Couldn't save availability", e?.message || 'Try again.'),
  });

  const addWindow = (day: number) =>
    setWindows((w) => [...w, { day_of_week: day, start_time: '07:00', end_time: '08:00' }]);

  const setTime = (idx: number, key: 'start_time' | 'end_time', v: string) => {
    // Keep it to digits and a colon so the server's HH:MM check passes.
    const clean = v.replace(/[^\d:]/g, '').slice(0, 5);
    setWindows((w) => w.map((x, i) => (i === idx ? { ...x, [key]: clean } : x)));
  };

  const removeWindow = (idx: number) => setWindows((w) => w.filter((_, i) => i !== idx));

  const invalid = windows.some(
    (w) => !/^\d{2}:\d{2}$/.test(w.start_time) || !/^\d{2}:\d{2}$/.test(w.end_time) || w.start_time >= w.end_time,
  );

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
        <Pressable onPress={onClose} className="flex-1 bg-black/75 justify-end">
          <Pressable onPress={(e) => e.stopPropagation()}>
            <View className="bg-atp-black rounded-t-3xl border-t border-white/10 pt-3" style={{ maxHeight: '92%' }}>
              <View className="self-center w-12 h-1 bg-white/20 rounded-full mb-4" />
              <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 28 }}>
                <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-2xl uppercase tracking-tight">
                  Weekly availability
                </Text>
                <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs mt-1.5 mb-5">
                  The hours members can book you for 1-on-1s. Times are 24-hour, Dubai time.
                </Text>

                {q.isLoading && <ActivityIndicator color={colors.green} className="my-6" />}

                {DAYS.map((label, day) => {
                  const rows = windows.map((w, i) => ({ w, i })).filter(({ w }) => w.day_of_week === day);
                  return (
                    <View key={day} className="mb-4">
                      <View className="flex-row items-center justify-between mb-2">
                        <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm uppercase tracking-widest">
                          {label}
                        </Text>
                        <Pressable onPress={() => addWindow(day)} hitSlop={8}>
                          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-[11px] uppercase tracking-widest">
                            + Add hours
                          </Text>
                        </Pressable>
                      </View>

                      {rows.length === 0 ? (
                        <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs">
                          Not available
                        </Text>
                      ) : (
                        rows.map(({ w, i }) => (
                          <View key={i} className="flex-row items-center gap-2 mb-2">
                            <TextInput
                              value={w.start_time}
                              onChangeText={(v) => setTime(i, 'start_time', v)}
                              placeholder="07:00"
                              placeholderTextColor={colors.muted}
                              keyboardType="numbers-and-punctuation"
                              style={{ fontFamily: fontFamily.body, color: colors.white }}
                              className="bg-atp-dark border border-white/10 rounded-atp px-3 py-2.5 text-sm w-24 text-center"
                            />
                            <Text style={{ color: colors.muted }}>–</Text>
                            <TextInput
                              value={w.end_time}
                              onChangeText={(v) => setTime(i, 'end_time', v)}
                              placeholder="08:00"
                              placeholderTextColor={colors.muted}
                              keyboardType="numbers-and-punctuation"
                              style={{ fontFamily: fontFamily.body, color: colors.white }}
                              className="bg-atp-dark border border-white/10 rounded-atp px-3 py-2.5 text-sm w-24 text-center"
                            />
                            <Pressable onPress={() => removeWindow(i)} hitSlop={8} className="ml-auto">
                              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.danger }} className="text-[11px] uppercase">
                                Remove
                              </Text>
                            </Pressable>
                          </View>
                        ))
                      )}
                    </View>
                  );
                })}

                {invalid && (
                  <Text style={{ fontFamily: fontFamily.body, color: colors.danger }} className="text-xs mb-3">
                    Check your times — use HH:MM and make sure each end is after its start.
                  </Text>
                )}

                <Pressable
                  onPress={() => saveMu.mutate()}
                  disabled={invalid || saveMu.isPending}
                  className={`rounded-atp py-4 items-center mt-2 ${!invalid && !saveMu.isPending ? 'bg-atp-green active:opacity-80' : 'bg-atp-dark-3'}`}
                >
                  <Text
                    style={{ fontFamily: fontFamily.bodyBold, color: !invalid && !saveMu.isPending ? colors.black : colors.muted }}
                    className="text-sm uppercase tracking-widest"
                  >
                    {saveMu.isPending ? 'Saving…' : 'Save availability'}
                  </Text>
                </Pressable>
                <Pressable onPress={onClose} className="py-3 items-center">
                  <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs uppercase tracking-widest">
                    Cancel
                  </Text>
                </Pressable>
              </ScrollView>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export default function CoachOfferings() {
  const q = useQuery({ queryKey: ['my-offerings'], queryFn: () => listMyOfferings().then((r) => r.offerings) });
  const availQ = useQuery({ queryKey: ['my-availability'], queryFn: getMyAvailability });
  const [editing, setEditing] = useState<CoachOffering | 'new' | null>(null);
  const [showAvail, setShowAvail] = useState(false);

  const offerings = q.data || [];
  const availCount = availQ.data?.availability?.length ?? 0;
  const liveCount = useMemo(() => offerings.filter((o) => o.is_active !== false).length, [offerings]);

  return (
    <SafeAreaView className="flex-1 bg-atp-black" edges={['top']}>
      <View className="px-5 pt-2 pb-3 flex-row items-center border-b border-white/5">
        <Pressable onPress={() => router.back()} className="py-2 -ml-2 px-2">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-lg">←</Text>
        </Pressable>
        <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-lg uppercase ml-2">
          My Offerings
        </Text>
        <Pressable onPress={() => setEditing('new')} className="ml-auto py-2 px-2" hitSlop={8}>
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-xs uppercase tracking-widest">
            + New
          </Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
        {q.isLoading && <ActivityIndicator color={colors.green} className="mt-10" />}

        {!q.isLoading && (
          <View className="px-5 mt-4">
            <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs mb-4">
              {offerings.length === 0
                ? 'Set up what members can book you for, one-to-one.'
                : `${liveCount} bookable · ${offerings.length - liveCount} paused`}
            </Text>

            {offerings.map((o) => (
              <Pressable
                key={o.id}
                onPress={() => setEditing(o)}
                className="bg-atp-dark border border-white/10 rounded-atp-lg p-4 mb-2.5 active:opacity-70"
              >
                <View className="flex-row items-start">
                  <View className="flex-1 pr-3">
                    <View className="flex-row items-center gap-2">
                      <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-base" numberOfLines={1}>
                        {o.title}
                      </Text>
                      {o.is_active === false && (
                        <Text
                          style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }}
                          className="text-[9px] uppercase tracking-widest border border-white/15 rounded-full px-2 py-0.5"
                        >
                          Paused
                        </Text>
                      )}
                    </View>
                    {!!o.description && (
                      <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs mt-1" numberOfLines={2}>
                        {o.description}
                      </Text>
                    )}
                    <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs mt-2">
                      {Number(o.duration_min) || 0} min
                    </Text>
                  </View>
                  <View className="items-end">
                    <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.green }} className="text-lg">
                      AED {Number(o.price_aed) || 0}
                    </Text>
                    <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-[10px] uppercase tracking-wider mt-0.5">
                      Tap to edit
                    </Text>
                  </View>
                </View>
              </Pressable>
            ))}

            {offerings.length === 0 && (
              <Pressable
                onPress={() => setEditing('new')}
                className="border border-dashed border-white/15 rounded-atp-lg py-8 items-center active:opacity-70"
              >
                <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-sm uppercase tracking-widest">
                  + Create your first offering
                </Text>
              </Pressable>
            )}

            {/* Availability — the other half of what the web hub does */}
            <Pressable
              onPress={() => setShowAvail(true)}
              className="bg-atp-dark border border-white/10 rounded-atp-lg p-4 mt-5 active:opacity-70"
            >
              <View className="flex-row items-center justify-between">
                <View className="flex-1 pr-3">
                  <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm">
                    Weekly availability
                  </Text>
                  <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs mt-1">
                    {availCount > 0
                      ? `${availCount} time window${availCount === 1 ? '' : 's'} set`
                      : 'No hours set — members can’t book you yet'}
                  </Text>
                </View>
                <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-xs uppercase tracking-widest">
                  Edit
                </Text>
              </View>
            </Pressable>
          </View>
        )}
      </ScrollView>

      <OfferingEditor offering={editing} onClose={() => setEditing(null)} />
      {showAvail && <AvailabilityEditor onClose={() => setShowAvail(false)} />}
    </SafeAreaView>
  );
}
