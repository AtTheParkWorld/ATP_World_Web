import { WEB_BASE } from '@/lib/api/client';
/**
 * About — app version, build, force-update gate state, and external
 * links (web, social, attribution). Force update polls /api/auth/version
 * once on mount and shows a friendly "update required" card if the
 * server has set a min_app_version above the bundled one.
 */
import { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Application from 'expo-application';
import { Platform } from 'react-native';
import { api } from '@/lib/api/client';
import { colors, fontFamily } from '@/lib/theme/tokens';

interface VersionResponse {
  ios:     { minimum: string; latest: string };
  android: { minimum: string; latest: string };
  force_update_message: string;
  soft_update_message:  string;
}

/** Returns -1 if a<b, 0 if equal, 1 if a>b. Pads shorter version. */
function compareSemver(a: string, b: string): number {
  const A = a.split('.').map((n) => parseInt(n, 10) || 0);
  const B = b.split('.').map((n) => parseInt(n, 10) || 0);
  while (A.length < B.length) A.push(0);
  while (B.length < A.length) B.push(0);
  for (let i = 0; i < A.length; i++) {
    if (A[i] < B[i]) return -1;
    if (A[i] > B[i]) return  1;
  }
  return 0;
}

export default function About() {
  const [versionInfo, setVersionInfo] = useState<VersionResponse | null>(null);
  const appVersion = Application.nativeApplicationVersion || '0.0.0';
  const buildNumber = Application.nativeBuildVersion || '?';

  useEffect(() => {
    api.get<VersionResponse>('/auth/version').then(setVersionInfo).catch(() => {});
  }, []);

  const platformInfo = versionInfo ? (Platform.OS === 'ios' ? versionInfo.ios : versionInfo.android) : null;
  const needsUpdate  = !!platformInfo && compareSemver(appVersion, platformInfo.minimum) < 0;

  return (
    <SafeAreaView className="flex-1 bg-atp-black" edges={['top']}>
      <View className="px-5 pt-2 pb-3 flex-row items-center border-b border-white/5">
        <Pressable onPress={() => router.back()} className="py-2 -ml-2 px-2">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-lg">←</Text>
        </Pressable>
        <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-lg uppercase ml-2">
          About
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 80 }}>
        <View className="items-center py-6">
          <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.green }} className="text-4xl uppercase tracking-tight">
            ATP
          </Text>
          <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-sm mt-1">
            At The Park
          </Text>
          <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs mt-3">
            v{appVersion}  ·  build {buildNumber}  ·  {Platform.OS}
          </Text>
          {!!platformInfo && (
            <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs mt-1">
              latest v{platformInfo.latest}
            </Text>
          )}
        </View>

        {needsUpdate && (
          <View className="bg-warning/10 border border-warning/40 rounded-atp p-4 mb-5">
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.warning }} className="text-sm uppercase tracking-widest mb-1">
              Update required
            </Text>
            <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-sm">
              You're on v{appVersion}; the minimum supported is v{platformInfo!.minimum}.
            </Text>
            <Pressable
              onPress={() => Linking.openURL(
                Platform.OS === 'ios'
                  ? 'https://apps.apple.com/app/at-the-park/id000000000'
                  : 'https://play.google.com/store/apps/details?id=world.atthepark.app'
              )}
              className="mt-3 bg-atp-green rounded-atp py-3 items-center active:opacity-80"
            >
              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.black }} className="text-sm uppercase tracking-widest">
                Update now
              </Text>
            </Pressable>
          </View>
        )}

        <Section title="ATP">
          <LinkRow label="atthepark.world" onPress={() => Linking.openURL(`${WEB_BASE}`)} />
          <LinkRow label="Instagram"        onPress={() => Linking.openURL('https://instagram.com/atthepark.world')} />
          <LinkRow label="TikTok"           onPress={() => Linking.openURL('https://tiktok.com/@atthepark.world')} />
        </Section>

        <Section title="Legal">
          <LinkRow label="Privacy policy" onPress={() => Linking.openURL(`${WEB_BASE}/privacy`)} />
          <LinkRow label="Terms of service" onPress={() => Linking.openURL(`${WEB_BASE}/terms`)} />
          <LinkRow label="Community guidelines" onPress={() => Linking.openURL(`${WEB_BASE}/guidelines`)} />
        </Section>

        <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="text-xs text-center mt-8">
          Made in the UAE for everyone who refuses to train alone.
        </Text>
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

function LinkRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center bg-atp-dark border border-white/5 rounded-atp px-4 py-3.5 active:opacity-70"
    >
      <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm flex-1">
        {label}
      </Text>
      <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }}>›</Text>
    </Pressable>
  );
}
