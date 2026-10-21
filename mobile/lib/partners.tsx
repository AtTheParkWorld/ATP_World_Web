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
  url: string;
  file: string;
  /** width / height of each trimmed file */
  ratio: Record<PartnerKind, number>;
}

export const PARTNERS: Partner[] = [
  { key: 'reebok', name: 'Reebok', re: /reebok/i, url: 'https://www.reebok.ae/', file: 'reebok', ratio: { lockup: 360 / 182, wordmark: 360 / 74, vector: 360 / 102 } },
];

type Named = { name?: string | null; session_name?: string | null; sponsor_name?: string | null };

export function partnerFor(x?: Named | string | null): Partner | null {
  const t = typeof x === 'string' ? x : x ? [x.name, x.session_name, x.sponsor_name].filter(Boolean).join(' ') : '';
  return t ? PARTNERS.find((p) => p.re.test(t)) ?? null : null;
}

export function partnerLogoUri(p: Partner, kind: PartnerKind = 'lockup', on: 'dark' | 'light' = 'dark'): string {
  return `${WEB_BASE}/img/partners/${p.file}-${kind}-${on === 'dark' ? 'white' : 'red'}.png`;
}

export function openPartner(p: Partner) {
  Linking.openURL(p.url).catch(() => {});
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
  if (!link) return img;
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
        Powered by
      </Text>
      <PartnerLogo partner={partner} on={on} height={height} />
    </View>
  );
}

// ── 30x30 hub partners (founder 2026-10-21) ────────────────────────
// The app twin of the landing page's Partners section. Logos sit on
// white tiles — UniCare's navy wordmark doesn't read on the dark app,
// and Reebok's guidelines want Vector Red on light.
export interface HubPartner {
  key: string; name: string; role: string; blurb: string; url: string; cta: string;
  logo: string; ratio: number; height: number;
}

export const HUB_PARTNERS: HubPartner[] = [
  {
    key: 'reebok', name: 'Reebok', role: 'Challenge partner',
    blurb: 'Partner of the Reebok Burpee Challenge. Training shoes, apparel and gear for every session at the hub.',
    url: 'https://www.reebok.ae/', cta: 'Visit reebok.ae', logo: 'reebok-lockup-red.png', ratio: 360 / 182, height: 64,
  },
  {
    key: 'unicare', name: 'UniCare Home Health', role: 'Home healthcare partner',
    blurb: 'Healthcare that comes to you in Dubai — a doctor on call, nursing care, physiotherapy and lab tests at home.',
    url: 'https://www.homehealthatunicare.com', cta: 'Explore UniCare services', logo: 'unicare-logo.png', ratio: 900 / 352, height: 58,
  },
];

export function HubPartners() {
  return (
    <View>
      <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-xs uppercase tracking-widest">Our partners</Text>
      <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-2xl uppercase mt-1">The brands behind the hub</Text>
      {HUB_PARTNERS.map((p) => (
        <Pressable
          key={p.key}
          onPress={() => Linking.openURL(p.url).catch(() => {})}
          accessibilityRole="link"
          accessibilityLabel={`${p.name} website`}
          className="mt-3 rounded-atp-lg overflow-hidden border border-white/10 active:opacity-80"
        >
          <View className="items-center justify-center py-7" style={{ backgroundColor: '#ffffff' }}>
            <Image
              source={{ uri: `${WEB_BASE}/img/partners/${p.logo}` }}
              style={{ height: p.height, width: Math.round(p.height * p.ratio) }}
              resizeMode="contain"
              accessibilityLabel={p.name}
            />
          </View>
          <View className="bg-atp-dark p-4">
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.danger }} className="text-[10px] uppercase tracking-widest">{p.role}</Text>
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-lg mt-0.5">{p.name}</Text>
            <Text style={{ fontFamily: fontFamily.body, color: colors.light }} className="text-sm mt-1 leading-5">{p.blurb}</Text>
            <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-sm mt-3">{p.cta} ↗</Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}
