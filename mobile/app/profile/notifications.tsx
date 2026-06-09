/**
 * Notification preferences. Phase 9 implements local toggles backed
 * by MMKV; the backend wiring (POST /api/notifications/preferences)
 * lands in the Phase 8 push PR. Until then, toggles are honored
 * client-side by the (Phase 8) OneSignal init layer.
 */
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { MMKV } from 'react-native-mmkv';
import { colors, fontFamily } from '@/lib/theme/tokens';

const store = new MMKV({ id: 'atp-notif-prefs' });

const PREFS = [
  { key: 'sessions',  label: 'Session reminders',  description: '24h + 1h before any booked session.' },
  { key: 'social',    label: 'Friends & community', description: 'Friend requests, likes, comments, replies.' },
  { key: 'streak',    label: 'Streak rescue',       description: '"3h left to save your streak" nudges.' },
  { key: 'rewards',   label: 'Rewards & offers',    description: 'New offers, expiring points, milestones.' },
  { key: 'marketing', label: 'News & events',       description: 'Monthly highlights + big launches.' },
] as const;

type Key = typeof PREFS[number]['key'];

function defaultEnabled(): Record<Key, boolean> {
  return { sessions: true, social: true, streak: true, rewards: true, marketing: false };
}

export default function Notifications() {
  const [state, setState] = useState<Record<Key, boolean>>(defaultEnabled());

  useEffect(() => {
    const next = defaultEnabled();
    for (const p of PREFS) {
      const v = store.getBoolean(p.key);
      if (v !== undefined) next[p.key] = v;
    }
    setState(next);
  }, []);

  function toggle(key: Key) {
    setState((s) => {
      const next = { ...s, [key]: !s[key] };
      store.set(key, next[key]);
      return next;
    });
  }

  return (
    <SafeAreaView className="flex-1 bg-atp-black" edges={['top']}>
      <View className="px-5 pt-2 pb-3 flex-row items-center border-b border-white/5">
        <Pressable onPress={() => router.back()} className="py-2 -ml-2 px-2">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-lg">←</Text>
        </Pressable>
        <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-lg uppercase ml-2">
          Notifications
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 80 }}>
        <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm mb-5">
          Choose what we ping you about. You can change these any time.
        </Text>

        {PREFS.map((p) => (
          <View
            key={p.key}
            className="flex-row items-center bg-atp-dark border border-white/5 rounded-atp px-4 py-3.5 mb-2"
          >
            <View className="flex-1 pr-3">
              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm">
                {p.label}
              </Text>
              <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs mt-0.5">
                {p.description}
              </Text>
            </View>
            <Switch
              value={state[p.key]}
              onValueChange={() => toggle(p.key)}
              trackColor={{ true: colors.green, false: colors.dark3 }}
              thumbColor={state[p.key] ? colors.white : colors.light}
            />
          </View>
        ))}

        <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs mt-6 leading-relaxed">
          To stop push notifications entirely, turn them off in your phone's system settings.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
