/**
 * Privacy & data screen. Three high-stakes actions all live behind
 * confirmation alerts:
 *   1) Export my data         — POST /members/me/export → emails a JSON archive
 *   2) Cancel pending deletion — restores the account if soft-deleted
 *   3) Delete my account       — POST /members/me/forget (soft-delete, 30d window)
 *
 * The delete flow surfaces both deletion-status (deletion_scheduled_at)
 * and a "Cancel deletion" CTA when the member is mid-window.
 */
import { Alert, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { useAuthStore } from '@/lib/stores/auth.store';
import { colors, fontFamily } from '@/lib/theme/tokens';

function getDeletionStatus(): Promise<{ deletion_scheduled_at: string | null }> {
  return api.get('/members/me/deletion-status').catch(() => ({ deletion_scheduled_at: null }));
}

export default function Privacy() {
  const qc = useQueryClient();
  const signOut = useAuthStore((s) => s.signOut);

  const statusQ = useQuery({ queryKey: ['deletion-status'], queryFn: getDeletionStatus });

  const exportMu = useMutation({
    mutationFn: () => api.post('/members/me/export'),
    onSuccess: () => Alert.alert(
      'Export started',
      "We'll email a downloadable copy of your data within 24 hours.",
    ),
    onError: (err) => Alert.alert('Could not start export', (err as Error).message || 'Try again.'),
  });

  const deleteMu = useMutation({
    mutationFn: () => api.post('/members/me/forget', { confirm: 'DELETE_MY_ACCOUNT' }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['deletion-status'] });
      Alert.alert(
        'Deletion scheduled',
        'Your account will be permanently deleted in 30 days. You can cancel any time before then.',
      );
    },
    onError: (err) => Alert.alert('Could not delete', (err as Error).message || 'Try again.'),
  });

  const cancelDeleteMu = useMutation({
    mutationFn: () => api.post('/members/me/cancel-deletion'),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['deletion-status'] });
      Alert.alert('Deletion cancelled', 'Welcome back. Your account is safe.');
    },
  });

  function onExportPress() {
    Alert.alert(
      'Export your data?',
      "We'll send a download link to your registered email within 24 hours.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Start export', onPress: () => exportMu.mutate() },
      ]
    );
  }

  function onDeletePress() {
    Alert.alert(
      'Delete your account?',
      'Your account will enter a 30-day grace period. After that, all your data is permanently erased.\n\nPoints, friendships, and history will be lost.',
      [
        { text: 'Keep account', style: 'cancel' },
        {
          text: 'Continue', style: 'destructive', onPress: () => {
            Alert.alert(
              'Final confirmation',
              'Type "DELETE" to confirm? (tap "Yes, delete" to proceed)',
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Yes, delete', style: 'destructive', onPress: () => deleteMu.mutate() },
              ]
            );
          },
        },
      ]
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-atp-black" edges={['top']}>
      <View className="px-5 pt-2 pb-3 flex-row items-center border-b border-white/5">
        <Pressable onPress={() => router.back()} className="py-2 -ml-2 px-2">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-lg">←</Text>
        </Pressable>
        <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-lg uppercase ml-2">
          Privacy & data
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 80 }}>
        {!!statusQ.data?.deletion_scheduled_at && (
          <View className="bg-warning/10 border border-warning/40 rounded-atp p-4 mb-5">
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.warning }} className="text-sm uppercase tracking-widest mb-1">
              Account deletion scheduled
            </Text>
            <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-sm">
              {(() => {
                const at  = new Date(statusQ.data!.deletion_scheduled_at!);
                const finalAt = new Date(at.getTime() + 30 * 24 * 60 * 60 * 1000);
                return `Your account will be permanently deleted on ${finalAt.toLocaleDateString()}.`;
              })()}
            </Text>
            <Pressable
              onPress={() => cancelDeleteMu.mutate()}
              disabled={cancelDeleteMu.isPending}
              className="mt-3 bg-atp-green rounded-atp py-3 items-center active:opacity-80"
            >
              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.black }} className="text-sm uppercase tracking-widest">
                {cancelDeleteMu.isPending ? 'Cancelling…' : 'Cancel deletion'}
              </Text>
            </Pressable>
          </View>
        )}

        <Section title="Your data">
          <ActionRow
            label="Export my data"
            description="We'll email a JSON archive of everything we know about you."
            onPress={onExportPress}
            busy={exportMu.isPending}
          />
          <ActionRow
            label="Privacy policy"
            description="Read what we collect and why."
            onPress={() => Linking.openURL('https://atthepark.world/privacy')}
          />
          <ActionRow
            label="Terms of service"
            description="The rules we all agree to."
            onPress={() => Linking.openURL('https://atthepark.world/terms')}
          />
        </Section>

        <Section title="Danger zone">
          <ActionRow
            label="Delete my account"
            description="30-day grace period; cancellable any time."
            onPress={onDeletePress}
            destructive
          />
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="mb-7">
      <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest mb-3">
        {title}
      </Text>
      <View className="gap-2">{children}</View>
    </View>
  );
}

function ActionRow({
  label, description, onPress, destructive, busy,
}: { label: string; description?: string; onPress: () => void; destructive?: boolean; busy?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      className="flex-row items-center bg-atp-dark border border-white/5 rounded-atp px-4 py-4 active:opacity-70"
    >
      <View className="flex-1">
        <Text
          style={{ fontFamily: fontFamily.bodyBold, color: destructive ? colors.danger : colors.white }}
          className="text-sm"
        >
          {busy ? 'Working…' : label}
        </Text>
        {!!description && (
          <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs mt-0.5">
            {description}
          </Text>
        )}
      </View>
      <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }}>›</Text>
    </Pressable>
  );
}
