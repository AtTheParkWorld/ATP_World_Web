/**
 * PostImage — feed photo that respects its own shape and opens full
 * screen on tap.
 *
 * Founder report 6A (2026-10-03): "on the app the faces are getting
 * cut". Feed photos were pinned to aspectRatio 4/3 with resizeMode
 * cover, while the composer tells members to post 4:5 portrait or 1:1
 * square. A 4:5 photo in a 4:3 frame loses roughly a quarter of its
 * height, top and bottom — which is exactly where faces are.
 *
 * The real ratio is measured and then clamped, so a photo is shown as
 * shot but one absurdly tall image still cannot take over the feed.
 *
 * Founder report 4A: tapping opens it full screen.
 */
import { useEffect, useState } from 'react';
import { Image, Modal, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { colors, fontFamily } from '@/lib/theme/tokens';

// 4:5 portrait is the tallest we show inline (the composer's own
// recommendation); 16:9 the widest. Anything outside is letterboxed
// rather than cropped through someone's face.
const MIN_RATIO = 4 / 5;
const MAX_RATIO = 16 / 9;

export function PostImage({ uri }: { uri: string }) {
  const [ratio, setRatio] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const { width, height } = useWindowDimensions();

  useEffect(() => {
    let alive = true;
    Image.getSize(
      uri,
      (w, h) => { if (alive && w > 0 && h > 0) setRatio(w / h); },
      () => { if (alive) setRatio(1); }   // unreadable → square, never 4:3
    );
    return () => { alive = false; };
  }, [uri]);

  const shown = ratio == null ? 1 : Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio));
  // Only crop when the photo is outside the allowed range; inside it the
  // ratio matches exactly, so cover and contain are identical and cover
  // avoids hairline gaps from rounding.
  const needsLetterbox = ratio != null && (ratio < MIN_RATIO || ratio > MAX_RATIO);

  return (
    <>
      <Pressable onPress={() => setOpen(true)} accessibilityRole="imagebutton" accessibilityLabel="Open photo full screen">
        <Image
          source={{ uri }}
          className="w-full mt-3 rounded-atp"
          style={{ aspectRatio: shown, backgroundColor: colors.dark2 }}
          resizeMode={needsLetterbox ? 'contain' : 'cover'}
        />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable
          onPress={() => setOpen(false)}
          className="flex-1 items-center justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.96)' }}
        >
          <Image
            source={{ uri }}
            style={{ width, height: height * 0.8 }}
            resizeMode="contain"
          />
          <View className="absolute top-14 right-5">
            <Pressable onPress={() => setOpen(false)} hitSlop={14} className="px-3 py-2">
              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-xl">✕</Text>
            </Pressable>
          </View>
          <Text style={{ fontFamily: fontFamily.body, color: colors.muted }} className="absolute bottom-12 text-xs">
            Tap anywhere to close
          </Text>
        </Pressable>
      </Modal>
    </>
  );
}
