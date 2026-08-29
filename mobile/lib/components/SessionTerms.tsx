/**
 * Booking terms gate (founder 2026-09-14: "terms and conditions feature
 * is not active" in the app). The website has gated its booking modal on
 * these for a while; the app let members book with no waiver at all —
 * and the live text is an accident waiver + liability release + media
 * consent, so this was a real gap, not a cosmetic one.
 *
 * Collapsed by default (a wall of legal text above the Book button
 * helps nobody), expandable to read in full, with a checkbox that the
 * caller uses to enable its confirm action.
 */
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { getSessionTerms } from '@/lib/api/cms';
import { colors, fontFamily } from '@/lib/theme/tokens';

export function SessionTerms({
  accepted,
  onToggle,
}: {
  accepted: boolean;
  onToggle: (next: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const termsQ = useQuery({
    queryKey: ['session-terms'],
    queryFn: getSessionTerms,
    staleTime: 1000 * 60 * 30,
  });

  return (
    <View className="mb-3">
      <Pressable
        onPress={() => setOpen((o) => !o)}
        hitSlop={6}
        className="flex-row items-center gap-1.5 mb-2"
        accessibilityRole="button"
      >
        <Text style={{ fontFamily: fontFamily.body, color: colors.green }} className="text-xs">
          {open ? '▾' : '▸'}
        </Text>
        <Text
          style={{ fontFamily: fontFamily.bodyBold, color: colors.green, textDecorationLine: 'underline' }}
          className="text-xs"
        >
          Terms & Conditions
        </Text>
      </Pressable>

      {open && (
        <View className="bg-atp-dark border border-white/10 rounded-atp mb-2" style={{ maxHeight: 200 }}>
          {termsQ.isLoading ? (
            <ActivityIndicator color={colors.green} style={{ margin: 16 }} />
          ) : (
            <ScrollView contentContainerStyle={{ padding: 12 }} nestedScrollEnabled>
              <Text style={{ fontFamily: fontFamily.body, color: colors.light, lineHeight: 18 }} className="text-xs">
                {termsQ.data}
              </Text>
            </ScrollView>
          )}
        </View>
      )}

      <Pressable
        onPress={() => onToggle(!accepted)}
        hitSlop={6}
        className="flex-row items-start gap-2.5"
        accessibilityRole="checkbox"
        accessibilityState={{ checked: accepted }}
      >
        <View
          className="items-center justify-center rounded"
          style={{
            width: 20, height: 20, marginTop: 1,
            borderWidth: 1.5,
            borderColor: accepted ? colors.green : 'rgba(255,255,255,0.35)',
            backgroundColor: accepted ? colors.green : 'transparent',
          }}
        >
          {accepted && (
            <Text style={{ color: colors.black, fontSize: 13, fontFamily: fontFamily.bodyBold, lineHeight: 15 }}>✓</Text>
          )}
        </View>
        <Text style={{ fontFamily: fontFamily.body, color: colors.white, flex: 1 }} className="text-xs">
          I have read and agree to the Terms & Conditions for this session.
        </Text>
      </Pressable>
    </View>
  );
}
