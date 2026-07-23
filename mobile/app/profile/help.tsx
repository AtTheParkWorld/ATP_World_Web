/**
 * Help & support. Static content + mailto/website CTAs — no backend
 * required. FAQs that resolve in-app cut down support tickets a lot,
 * so we surface them first.
 */
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { colors, fontFamily } from '@/lib/theme/tokens';

const FAQS = [
  {
    q: 'How do I earn points?',
    a: 'Book and attend free sessions, hit attendance streaks, refer friends who attend their first session, and complete your profile (one-time +200 pts).',
  },
  {
    q: 'Why didn\'t my booking confirm?',
    a: 'If the session was full you\'re on the waitlist — we\'ll text you the moment a spot opens. Paid bookings stay "pending payment" for 30 minutes; finish payment within that window or the seat is released.',
  },
  {
    q: 'What\'s my tribe?',
    a: 'Tribes are the three communities inside ATP — Better, Faster, Stronger. Pick one in your profile to unlock tribe-only sessions and the team leaderboard.',
  },
  {
    q: 'How do I cancel a session?',
    a: 'Open the session in the app and tap Cancel. Cancelling within 2 hours of start may forfeit points reward.',
  },
  {
    q: 'I need to change my email or tribe.',
    a: 'These need a quick check from our team. Tap "Email support" below and we\'ll fix it within 24 hours.',
  },
];

export default function Help() {
  return (
    <SafeAreaView className="flex-1 bg-atp-black" edges={['top']}>
      <View className="px-5 pt-2 pb-3 flex-row items-center border-b border-white/5">
        <Pressable onPress={() => router.back()} className="py-2 -ml-2 px-2">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-lg">←</Text>
        </Pressable>
        <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-lg uppercase ml-2">
          Help & support
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 80 }}>
        <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest mb-3">
          Quick answers
        </Text>
        {FAQS.map((f) => (
          <View key={f.q} className="bg-atp-dark border border-white/5 rounded-atp p-4 mb-2">
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm">
              {f.q}
            </Text>
            <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-sm mt-2 leading-relaxed">
              {f.a}
            </Text>
          </View>
        ))}

        <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="text-xs uppercase tracking-widest mt-7 mb-3">
          Still stuck?
        </Text>
        <View className="gap-2">
          <Pressable
            onPress={() => Linking.openURL('mailto:support@atthepark.world?subject=ATP%20Mobile%20Support')}
            className="bg-atp-green rounded-atp px-4 py-4 items-center active:opacity-80"
          >
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.black }} className="text-sm uppercase tracking-widest">
              Email support
            </Text>
          </Pressable>
          <Pressable
            onPress={() => Linking.openURL('https://wa.me/971585792378')}
            className="bg-atp-dark border border-white/10 rounded-atp px-4 py-4 items-center active:opacity-80"
          >
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-sm uppercase tracking-widest">
              WhatsApp us
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
