/**
 * Onboarding step 3 — pick a home city.
 *
 * Drives the default city filter on Sessions, lets us send city-
 * specific session reminders, and feeds the city leaderboard.
 */
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listCities } from '@/lib/api/sessions';
import { patchProfile } from '@/lib/api/members';
import { colors, fontFamily } from '@/lib/theme/tokens';

export default function OnboardingCity() {
  const qc = useQueryClient();
  const citiesQ = useQuery({ queryKey: ['cities'], queryFn: () => listCities().then(r => r.cities), staleTime: 1000 * 60 * 30 });

  const pickMu = useMutation({
    mutationFn: (city_id: string) => patchProfile({ city_id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profile'] });
      router.push('/onboarding/notifications');
    },
    onError: (err) => Alert.alert('Could not save', (err as Error).message || 'Try again.'),
  });

  return (
    <SafeAreaView className="flex-1 bg-atp-black" edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 40 }}>
        <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs uppercase tracking-widest">
          Step 2 of 3
        </Text>
        <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-4xl uppercase tracking-tight mt-2">
          Where do{'\n'}you train?
        </Text>
        <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-base mt-3 leading-relaxed">
          Pick your home city. We'll show sessions near you first and use this for the city leaderboard.
        </Text>

        <View className="mt-7 gap-2">
          {(citiesQ.data || []).map((c) => (
            <Pressable
              key={c.id}
              onPress={() => pickMu.mutate(c.id)}
              disabled={pickMu.isPending}
              className="bg-atp-dark border border-white/10 rounded-atp p-4 active:opacity-80 flex-row items-center"
            >
              <Text style={{ fontSize: 22, marginRight: 12 }}>📍</Text>
              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-lg flex-1">
                {c.name}
              </Text>
              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }}>›</Text>
            </Pressable>
          ))}
        </View>

        <Pressable onPress={() => router.push('/onboarding/notifications')} className="py-4 items-center mt-4">
          <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-sm">
            Skip for now
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
