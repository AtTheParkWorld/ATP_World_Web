/**
 * Our Story (founder 2026-09-23: "on the app there is no place to tell
 * our story").
 *
 * Reads the same CMS section the website's homepage story block uses —
 * admin → CMS → Home → Story — so editing it once changes both
 * surfaces. The site's current copy ships as the fallback, so the
 * screen is never blank even before anything is saved in admin.
 */
import { Image, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { getStoryContent } from '@/lib/api/cms';
import { MarkdownBody } from '@/lib/components/MarkdownBody';
import { colors, fontFamily } from '@/lib/theme/tokens';
import { absUrl } from '@/lib/utils/imageUrl';

export default function Story() {
  const { width } = useWindowDimensions();
  const q = useQuery({
    queryKey: ['story'],
    queryFn: getStoryContent,
    staleTime: 1000 * 60 * 30,
  });

  const s = q.data;
  const photo = absUrl(s?.founder_photo || undefined);

  return (
    <SafeAreaView className="flex-1 bg-atp-black" edges={['top']}>
      <View className="px-5 pt-2 pb-3 flex-row items-center border-b border-white/5">
        <Pressable onPress={() => router.back()} className="py-2 -ml-2 px-2">
          <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-lg">←</Text>
        </Pressable>
        <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-lg uppercase ml-2">
          Our Story
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
        {!!photo && (
          <Image
            source={{ uri: photo }}
            style={{ width: '100%', height: Math.round(width * 0.78), backgroundColor: colors.dark2 }}
            resizeMode="cover"
          />
        )}

        <View className="px-5 mt-6">
          <Text
            style={{ fontFamily: fontFamily.bodyBold, color: colors.green }}
            className="text-[11px] uppercase tracking-[2px] mb-2"
          >
            Est. 2015 · Abu Dhabi
          </Text>
          <Text
            style={{ fontFamily: fontFamily.displayBlack, color: colors.white }}
            className="text-3xl uppercase tracking-tight"
          >
            {s?.title || 'Our story'}
          </Text>

          <View className="mt-4">
            {!!s?.body && <MarkdownBody body={s.body} />}
          </View>

          {/* Founders' line — the emotional centre of the page on web */}
          {!!s?.quote && (
            <View className="border-l-2 border-atp-green pl-4 my-5">
              <Text
                style={{ fontFamily: fontFamily.body, color: colors.white, fontStyle: 'italic' }}
                className="text-base leading-relaxed"
              >
                “{s.quote}”
              </Text>
              {!!s.quote_attrib && (
                <Text
                  style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }}
                  className="text-[11px] uppercase tracking-widest mt-2.5"
                >
                  {s.quote_attrib}
                </Text>
              )}
            </View>
          )}

          {/* Milestones */}
          {!!s?.milestones?.length && (
            <View className="mt-4">
              <Text
                style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }}
                className="text-xs uppercase tracking-widest mb-4"
              >
                How we got here
              </Text>
              {s.milestones.map((m, i) => (
                <View key={m.year} className="flex-row">
                  {/* rail */}
                  <View className="items-center mr-4" style={{ width: 14 }}>
                    <View className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: colors.green }} />
                    {i < s.milestones.length - 1 && (
                      <View className="flex-1 w-px my-1" style={{ backgroundColor: 'rgba(255,255,255,0.14)' }} />
                    )}
                  </View>
                  <View className="flex-1 pb-6">
                    <Text
                      style={{ fontFamily: fontFamily.displayBlack, color: colors.green }}
                      className="text-xl"
                    >
                      {m.year}
                    </Text>
                    <Text
                      style={{ fontFamily: fontFamily.body, color: colors.light }}
                      className="text-sm mt-0.5 leading-relaxed"
                    >
                      {m.event}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* Where it goes next — a story page should end with a door */}
          <Pressable
            onPress={() => router.push('/(tabs)/sessions')}
            className="bg-atp-green rounded-atp py-4 items-center mt-2 active:opacity-80"
          >
            <Text
              style={{ fontFamily: fontFamily.bodyBold, color: colors.black }}
              className="text-sm uppercase tracking-widest"
            >
              Find your first session
            </Text>
          </Pressable>
          <Pressable onPress={() => router.push('/crew')} className="py-3.5 items-center">
            <Text
              style={{ fontFamily: fontFamily.body, color: colors.muted }}
              className="text-xs uppercase tracking-widest"
            >
              Bring someone with you
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
