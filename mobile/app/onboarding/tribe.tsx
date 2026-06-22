/**
 * Onboarding step 2 — pick a tribe.
 *
 * Tribes drive the in-app feed segmentation, team leaderboards, and
 * tribe-only sessions. Required step (no skip).
 */
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listTribes } from '@/lib/api/sessions';
import { patchProfile } from '@/lib/api/members';
import { useAuthStore } from '@/lib/stores/auth.store';
import { colors, fontFamily, tribeColor } from '@/lib/theme/tokens';

export default function OnboardingTribe() {
  const qc = useQueryClient();
  const updateMember = useAuthStore((s) => s.updateMember);

  const tribesQ = useQuery({ queryKey: ['tribes'], queryFn: () => listTribes().then(r => r.tribes), staleTime: 1000 * 60 * 30 });

  const pickMu = useMutation({
    mutationFn: (tribe_id: string) => patchProfile({ tribe_id }),
    onSuccess: (_res, tribe_id) => {
      const picked = tribesQ.data?.find((t) => t.id === tribe_id);
      if (picked) updateMember({ tribe_name: picked.name, tribe_color: picked.color || undefined } as any);
      qc.invalidateQueries({ queryKey: ['profile'] });
      router.push('/onboarding/city');
    },
    onError: (err) => Alert.alert('Could not save', (err as Error).message || 'Try again.'),
  });

  return (
    <SafeAreaView className="flex-1 bg-atp-black" edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 40 }}>
        <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs uppercase tracking-widest">
          Step 1 of 3
        </Text>
        <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-4xl uppercase tracking-tight mt-2">
          Pick your{'\n'}tribe.
        </Text>
        <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-base mt-3 leading-relaxed">
          Your tribe is your team — you'll see their workouts on your feed and climb the leaderboard together. You can change it later in Settings.
        </Text>

        <View className="mt-7 gap-3">
          {(tribesQ.data || []).map((t) => {
            const c = tribeColor(t.slug);
            return (
              <Pressable
                key={t.id}
                onPress={() => pickMu.mutate(t.id)}
                disabled={pickMu.isPending}
                className="rounded-atp-lg p-5 border-2 active:opacity-80"
                style={{ borderColor: c, backgroundColor: c + '15' }}
              >
                <Text style={{ fontFamily: fontFamily.displayBlack, color: c }} className="text-2xl uppercase tracking-tight">
                  {t.name}
                </Text>
                {!!t.description && (
                  <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-sm mt-2 leading-relaxed">
                    {t.description}
                  </Text>
                )}
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
