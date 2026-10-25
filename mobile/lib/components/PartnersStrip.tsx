/**
 * "Our partners" on the Home tab (founder 2026-10-25: "ensure the app is
 * updated on this as well") — the admin's partner directory, same as the
 * website. Each logo sits on a white plate (logos come on white or in
 * brand colours — Reebok's guidelines want Vector Red on light); tapping
 * a partner opens their website. Renders nothing until there are partners.
 */
import { Image, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { listPartners } from '@/lib/api/partners';
import { absUrl } from '@/lib/utils/imageUrl';
import { colors, fontFamily } from '@/lib/theme/tokens';

const safeHttp = (u?: string | null) => (u && /^https?:\/\//i.test(u.trim()) ? u.trim() : null);

export function PartnersStrip() {
  const q = useQuery({ queryKey: ['partners', 'directory'], queryFn: () => listPartners().then((r) => r.partners || []), staleTime: 1000 * 60 * 30 });
  const partners = (q.data || []).filter((p) => p && p.name);
  if (!partners.length) return null;
  return (
    <View className="mt-8">
      <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.muted }} className="px-5 text-xs uppercase tracking-widest mb-3">
        Our partners
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}>
        {partners.map((p) => {
          const url = safeHttp(p.website_url);
          const logo = p.logo_url ? absUrl(p.logo_url) : null;
          return (
            <Pressable
              key={p.id}
              disabled={!url}
              onPress={() => url && Linking.openURL(url).catch(() => {})}
              accessibilityRole={url ? 'link' : undefined}
              accessibilityLabel={`${p.name}${url ? ' website' : ''}`}
              className="rounded-atp-lg overflow-hidden border border-white/10 active:opacity-80"
              style={{ width: 168 }}
            >
              <View className="items-center justify-center px-4" style={{ backgroundColor: '#ffffff', height: 104 }}>
                {logo ? (
                  <Image source={{ uri: logo }} style={{ width: 136, height: 72 }} resizeMode="contain" accessibilityLabel={p.name} />
                ) : (
                  <Text style={{ fontFamily: fontFamily.displayBlack, color: '#222' }} className="text-base uppercase text-center">{p.name}</Text>
                )}
              </View>
              <View className="bg-atp-dark flex-row items-center justify-between px-3 py-2.5">
                <Text numberOfLines={1} style={{ fontFamily: fontFamily.bodyBold, color: colors.white, flex: 1 }} className="text-xs uppercase">{p.name}</Text>
                {!!url && <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-[10px] uppercase ml-2">Visit ↗</Text>}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
