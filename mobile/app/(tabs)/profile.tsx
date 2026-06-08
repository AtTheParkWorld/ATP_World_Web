import { SafeAreaView, Text, View, Pressable } from 'react-native';
import { useAuthStore } from '@/lib/stores/auth.store';
import { fontFamily, colors } from '@/lib/theme/tokens';
// Phase 9 (Settings + Privacy + Compliance) fills in fully. The signOut
// button is wired here from day-one because every screen below depends
// on being able to recover from a broken session.
export default function Profile() {
  const member  = useAuthStore((s) => s.member);
  const signOut = useAuthStore((s) => s.signOut);
  const name = ((member?.first_name || '') + ' ' + (member?.last_name || '')).trim() || 'Member';
  return (
    <SafeAreaView className="flex-1 bg-atp-black">
      <View className="p-5 gap-6">
        <View>
          <Text style={{ fontFamily: fontFamily.displayBlack }} className="text-atp-white text-3xl uppercase">{name}</Text>
          <Text style={{ fontFamily: fontFamily.body }} className="text-atp-light text-sm mt-1">{member?.email}</Text>
          {!!member?.tribe_name && (
            <Text style={{ fontFamily: fontFamily.bodyBold, color: member.tribe_color || colors.green }} className="text-xs uppercase mt-2 tracking-widest">
              {member.tribe_name} Tribe
            </Text>
          )}
        </View>

        <View className="rounded-atp-lg bg-atp-dark border border-white/5 p-4">
          <Text style={{ fontFamily: fontFamily.bodyBold }} className="text-atp-light text-xs uppercase tracking-widest mb-2">Phase 9 placeholder</Text>
          <Text style={{ fontFamily: fontFamily.body }} className="text-atp-white text-base leading-relaxed">
            Settings, privacy controls, data export, account deletion, push preferences ship in Phase 9.
          </Text>
        </View>

        <Pressable
          onPress={() => signOut()}
          className="rounded-atp border border-white/10 py-3 items-center mt-8"
        >
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.danger }} className="text-sm tracking-wide">
            Sign out
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
