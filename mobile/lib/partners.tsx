/**
 * Partner brands on sessions + 30x30 challenges (founder 2026-10-21: "add
 * Reebok logo everywhere on our website and app we can explore
 * visibility"). The app twin of backend/public/partners.js — same list,
 * same files, served from the website so an OTA (or a new file there)
 * is all a new partner needs.
 *
 * A session / booking / challenge belongs to a partner when its name (or
 * the admin's "Powered by" sponsor name) mentions the brand.
 *
 * Reebok brand guidelines (2022): official files only — never recoloured,
 * stretched or given effects (these are their PNGs, trimmed of padding).
 * Classic White on dark backgrounds (the app), Vector Red on light ones
 * (the white QR card). Clear space around the mark; bottom-right /
 * top-right where there is a choice.
 *
 * Tapping a logo opens the partner's site (founder 2026-10-21) — except
 * the small marks inside rows that open a session (link={false}).
 */
import { Image, Linking, Pressable, Text, View } from 'react-native';
import { WEB_BASE } from '@/lib/api/client';
import { colors, fontFamily } from '@/lib/theme/tokens';

export type PartnerKind = 'lockup' | 'wordmark' | 'vector';

export interface Partner {
  key: string;
  name: string;
  re: RegExp;
  /** Partner site; no link when missing (5:30 Run). */
  url?: string;
  file: string;
  /** Wording before the logo — default "Powered by". */
  label?: string;
  /** width / height of each trimmed file */
  ratio: Record<PartnerKind, number>;
  /** One official file per background, used for every kind (Zoga) —
   *  instead of Reebok's `<file>-<kind>-<white|red>.png` set. */
  logo?: { dark: string; light: string };
}

export const PARTNERS: Partner[] = [
  { key: 'reebok', name: 'Reebok', re: /reebok/i, url: 'https://www.reebok.ae/', file: 'reebok', ratio: { lockup: 360 / 182, wordmark: 360 / 74, vector: 360 / 102 } },
  // Zoga (founder 2026-10-30): its 30x30 Hub sessions ("… by Zoga") link
  // to their Internet City shala. Their white logo on the dark app, the
  // terracotta one on light cards (QR).
  { key: 'zoga', name: 'Zoga', re: /\bzoga\b/i, url: 'https://zoga.ae/book-a-class-internet-city-shala/', file: 'zoga', logo: { dark: 'zoga-logo-white.png', light: 'zoga-logo.png' }, ratio: { lockup: 720 / 230, wordmark: 720 / 230, vector: 720 / 230 } },
  // 5:30 Run (founder 2026-10-30): the Pink Run is "In collaboration with
  // 530run". One file (gold + teal, transparent) on dark and light; links
  // to their WhatsApp community.
  { key: 'run530', name: '5:30 Run', re: /pink run/i, url: 'https://chat.whatsapp.com/JdC1ZSC2Yfc3SnFZLXwPfJ?mode=gi_t', label: 'In collaboration with', file: '530run', logo: { dark: '530run-logo.png', light: '530run-logo.png' }, ratio: { lockup: 550 / 246, wordmark: 550 / 246, vector: 550 / 246 } },
];

type Named = { name?: string | null; session_name?: string | null; sponsor_name?: string | null };

export function partnerFor(x?: Named | string | null): Partner | null {
  const t = typeof x === 'string' ? x : x ? [x.name, x.session_name, x.sponsor_name].filter(Boolean).join(' ') : '';
  return t ? PARTNERS.find((p) => p.re.test(t)) ?? null : null;
}

export function partnerLogoUri(p: Partner, kind: PartnerKind = 'lockup', on: 'dark' | 'light' = 'dark'): string {
  if (p.logo) return `${WEB_BASE}/img/partners/${p.logo[on]}`;
  return `${WEB_BASE}/img/partners/${p.file}-${kind}-${on === 'dark' ? 'white' : 'red'}.png`;
}

export function openPartner(p: Partner) {
  if (p.url) Linking.openURL(p.url).catch(() => {});
}

export function PartnerLogo({ partner, kind = 'lockup', on = 'dark', height, link = true }: {
  partner: Partner; kind?: PartnerKind; on?: 'dark' | 'light'; height: number; link?: boolean;
}) {
  const img = (
    <Image
      source={{ uri: partnerLogoUri(partner, kind, on) }}
      style={{ height, width: Math.round(height * partner.ratio[kind]) }}
      resizeMode="contain"
      accessibilityLabel={partner.name}
    />
  );
  if (!link || !partner.url) return img;
  // Its own Pressable wins over the card it sits on — the card still
  // opens everywhere else.
  return (
    <Pressable onPress={() => openPartner(partner)} hitSlop={8} accessibilityRole="link" accessibilityLabel={`${partner.name} website`} className="active:opacity-70">
      {img}
    </Pressable>
  );
}

/** "POWERED BY <logo>" — the same strip the website shows. */
export function PoweredBy({ partner, on = 'dark', height = 30, align = 'flex-end' }: {
  partner: Partner; on?: 'dark' | 'light'; height?: number; align?: 'flex-start' | 'center' | 'flex-end';
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: align, gap: 10 }}>
      <Text style={{ fontFamily: fontFamily.bodyBold, color: on === 'dark' ? colors.muted : '#666' }} className="text-[9px] uppercase tracking-widest">
        {partner.label ?? 'Powered by'}
      </Text>
      <PartnerLogo partner={partner} on={on} height={height} />
    </View>
  );
}

// ── 30x30 hub partners (founder 2026-10-21) ────────────────────────
// The app twin of the landing page's "Our Partners": just the logos,
// each opening the partner's site. White tiles — UniCare's navy wordmark
// doesn't read on the dark app, and Reebok's guidelines want Vector Red
// on light.
export interface HubPartner { key: string; name: string; url?: string; logo: string; ratio: number; height: number }

export const HUB_PARTNERS: HubPartner[] = [
  { key: 'reebok', name: 'Reebok', url: 'https://www.reebok.ae/', logo: 'reebok-lockup-red.png', ratio: 360 / 182, height: 46 },
  { key: 'unicare', name: 'UniCare Home Health', url: 'https://www.homehealthatunicare.com', logo: 'unicare-logo.png', ratio: 900 / 352, height: 40 },
  { key: 'alwasl', name: 'Al Wasl Water', url: 'https://alwaslwater.com/', logo: 'alwasl-logo.png', ratio: 700 / 721, height: 88 },
  // Event partners added 2026-10-30. Marriott Bonvoy + Grand Plaza have
  // no link yet (founder to send their URLs).
  { key: 'zoga', name: 'Zoga', url: 'https://zoga.ae/book-a-class-internet-city-shala/', logo: 'zoga-logo.png', ratio: 720 / 230, height: 36 },
  { key: 'marriott', name: 'Marriott Bonvoy', logo: 'marriott-bonvoy-logo.png', ratio: 900 / 268, height: 36 },
  { key: 'grandplaza', name: 'Grand Plaza Mövenpick Media City', logo: 'grandplaza-logo.png', ratio: 1000 / 295, height: 38 },
];

export function HubPartners() {
  return (
    <View>
      <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-2xl uppercase">Our Partners</Text>
      {/* Two per row; an odd last tile sits centred at the same width. */}
      <View className="flex-row flex-wrap justify-center mt-3" style={{ gap: 12 }}>
        {HUB_PARTNERS.map((p) => (
          <Pressable
            key={p.key}
            onPress={p.url ? () => Linking.openURL(p.url!).catch(() => {}) : undefined}
            disabled={!p.url}
            accessibilityRole={p.url ? 'link' : 'image'}
            accessibilityLabel={p.url ? `${p.name} website` : p.name}
            className="items-center justify-center rounded-atp-lg px-3 active:opacity-80"
            style={{ backgroundColor: '#ffffff', flexBasis: '47%', flexGrow: 0, height: 120 }}
          >
            <Image
              source={{ uri: `${WEB_BASE}/img/partners/${p.logo}` }}
              style={{ height: p.height, width: Math.round(p.height * p.ratio), maxWidth: '100%' }}
              resizeMode="contain"
              accessibilityLabel={p.name}
            />
          </Pressable>
        ))}
      </View>
    </View>
  );
}
