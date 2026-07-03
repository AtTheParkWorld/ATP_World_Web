/**
 * "My device this week" — Home-screen mirror of the member's wearable
 * data (Garmin / Strava / Fitbit).
 *
 * Connected  → provider name + ● Synced badge + 4 stat tiles
 *              (workouts · km · calories · active minutes).
 * Not linked → compact connect card listing the enabled providers;
 *              tapping one opens the OAuth flow in the system browser
 *              and re-queries when the browser session closes.
 *
 * Silent while loading (renders nothing) so the Home scroll never
 * jumps for members who don't use the feature.
 */
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getMine, getConnectUrl, type WearablesMe } from '@/lib/api/wearables';
import { colors, fontFamily } from '@/lib/theme/tokens';

function fmtKm(m?: number | null): string {
  const km = (Number(m) || 0) / 1000;
  return km >= 100 ? String(Math.round(km)) : km.toFixed(1);
}
function fmtMin(s?: number | null): string {
  return String(Math.round((Number(s) || 0) / 60));
}

export function DeviceWeekCard() {
  const qc = useQueryClient();
  const [connecting, setConnecting] = useState<string | null>(null);

  const q = useQuery<WearablesMe>({
    queryKey: ['wearables-me'],
    queryFn: getMine,
    staleTime: 1000 * 60 * 5,
  });

  if (q.isLoading || !q.data) return null;

  const active = (q.data.connections || []).filter((c) => c.status === 'active');
  const enabledProviders = (q.data.available || []).filter((p) => p.enabled);

  const connect = async (provider: string) => {
    try {
      setConnecting(provider);
      const { redirect_url } = await getConnectUrl(provider);
      await WebBrowser.openAuthSessionAsync(redirect_url);
      // Whatever happened in the browser, re-pull state.
      await qc.invalidateQueries({ queryKey: ['wearables-me'] });
    } catch {
      // Silent — the Devices screen has full error surfaces; the Home
      // card stays lightweight.
    } finally {
      setConnecting(null);
    }
  };

  // ── Not connected: compact connect CTA ─────────────────────────
  if (!active.length) {
    if (!enabledProviders.length) return null; // nothing to offer
    return (
      <View className="mx-5 mt-5 bg-atp-dark rounded-atp-lg border border-white/5 p-4">
        <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted, letterSpacing: 1.2 }} className="text-xs uppercase">
          ⌚ My device this week
        </Text>
        <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-sm mt-2 leading-relaxed">
          Connect your watch to count workouts toward challenges and see your week at a glance.
        </Text>
        <View className="flex-row gap-2 mt-3 flex-wrap">
          {enabledProviders.map((p) => (
            <Pressable
              key={p.name}
              disabled={!!connecting}
              onPress={() => connect(p.name)}
              className="bg-atp-green/10 border border-atp-green/40 rounded-atp px-4 py-2.5 active:opacity-70"
            >
              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-xs uppercase tracking-widest">
                {connecting === p.name ? 'Opening…' : p.displayName}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    );
  }

  // ── Connected: stats mirror ────────────────────────────────────
  const week = q.data.week || {};
  const provider = active[0];
  const label = provider.provider.charAt(0).toUpperCase() + provider.provider.slice(1);

  return (
    <View className="mx-5 mt-5 bg-atp-dark rounded-atp-lg border border-white/5 p-4">
      <View className="flex-row items-center justify-between">
        <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted, letterSpacing: 1.2 }} className="text-xs uppercase">
          ⌚ My device this week
        </Text>
        <View className="flex-row items-center gap-1.5">
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.green }} />
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green, letterSpacing: 1 }} className="text-[10px] uppercase">
            {label}
          </Text>
        </View>
      </View>

      <View className="flex-row mt-4">
        <Stat value={String(week.workout_count ?? 0)} label="Workouts" />
        <Stat value={fmtKm(week.distance_m)} label="km" />
        <Stat value={String(week.calories ?? 0)} label="Calories" />
        <Stat value={fmtMin(week.duration_s)} label="Active min" />
      </View>
    </View>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View className="flex-1 items-center">
      <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.green }} className="text-2xl">
        {value}
      </Text>
      <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted, letterSpacing: 1 }} className="text-[10px] uppercase mt-1">
        {label}
      </Text>
    </View>
  );
}
