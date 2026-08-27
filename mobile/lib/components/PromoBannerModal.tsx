/**
 * Sponsor pop-up (founder 2026-08-30) — admin-managed promo shown once
 * per app open, after the member is signed in. Image or muted looping
 * video, always closable (X + backdrop tap), tap-through opens the
 * sponsor link. Impression counted when shown, click when tapped —
 * that's the number the sponsor is paying for.
 *
 * Shows at most ONCE per cold start (module-level flag): backgrounding
 * and returning doesn't re-trigger it — a member checking a QR code
 * mid-session must never fight an ad to get back.
 */
import { useEffect, useState } from 'react';
import { Image, Linking, Modal, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { getActivePromo, trackPromoClick, trackPromoImpression, type PromoBanner } from '@/lib/api/promos';
import { useAuthStore } from '@/lib/stores/auth.store';
import { colors, fontFamily } from '@/lib/theme/tokens';

let shownThisLaunch = false;

function PromoVideo({ uri, height }: { uri: string; height: number }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });
  return (
    <VideoView
      player={player}
      style={{ width: '100%', height, backgroundColor: '#000' }}
      contentFit="contain"
      nativeControls={false}
    />
  );
}

export function PromoBannerModal() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const [banner, setBanner] = useState<PromoBanner | null>(null);
  const { width, height } = useWindowDimensions();

  useEffect(() => {
    if (!accessToken || shownThisLaunch) return;
    let cancelled = false;
    // Let the home screen paint first — the popup is a curtain over a
    // loaded app, not a gate in front of it.
    const t = setTimeout(() => {
      getActivePromo()
        .then(({ banner: b }) => {
          if (cancelled || !b || shownThisLaunch) return;
          shownThisLaunch = true;
          setBanner(b);
          trackPromoImpression(b.id);
        })
        .catch(() => {});
    }, 1500);
    return () => { cancelled = true; clearTimeout(t); };
  }, [accessToken]);

  if (!banner) return null;

  const close = () => setBanner(null);
  const open = () => {
    if (!banner.link_url) return;
    trackPromoClick(banner.id);
    Linking.openURL(banner.link_url).catch(() => {});
    close();
  };

  // Near-full-screen (founder 2026-08-31): the card spans almost the
  // whole viewport, media letterboxed inside; mild translucency so the
  // app glows through behind it.
  const cardWidth = width - 24;
  const mediaHeight = Math.round(height * 0.68);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={close}>
      <Pressable
        onPress={close}
        className="flex-1 items-center justify-center px-5"
        style={{ backgroundColor: 'rgba(0,0,0,0.82)' }}
      >
        {/* Inner pressable swallows taps so backdrop-close only fires outside the card */}
        <Pressable onPress={banner.link_url ? open : undefined} style={{ width: cardWidth }}>
          <View className="rounded-atp-lg overflow-hidden border border-atp-green/25 bg-atp-dark" style={{ opacity: 0.93 }}>
            {banner.type === 'video' ? (
              <PromoVideo uri={banner.media_url} height={mediaHeight} />
            ) : (
              <Image
                source={{ uri: banner.media_url }}
                style={{ width: '100%', height: mediaHeight, backgroundColor: '#000' }}
                resizeMode="contain"
              />
            )}
            {!!banner.link_url && (
              <View className="flex-row items-center justify-end px-4 py-2.5">
                <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-[11px] uppercase tracking-widest">
                  Learn more →
                </Text>
              </View>
            )}
          </View>
          {/* Close — outside the card corner, 44pt hit area */}
          <Pressable
            onPress={close}
            hitSlop={10}
            className="absolute -top-3 -right-3 w-9 h-9 rounded-full items-center justify-center border border-white/25"
            style={{ backgroundColor: 'rgba(0,0,0,0.75)' }}
          >
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-base leading-5">
              ×
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
