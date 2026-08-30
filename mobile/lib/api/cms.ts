/**
 * CMS-backed copy the app needs at runtime. Today: the session booking
 * terms (accident waiver / liability release / media consent) that the
 * website already gates its booking modal on — the app must gate on the
 * SAME text so a booking means the same thing on either device.
 */
import { api } from './client';

const FALLBACK_TERMS =
  'By booking this session you agree that participation is at your own risk. ' +
  "Please arrive on time and follow the coach's safety instructions throughout. " +
  'If you can no longer attend, cancel via your profile so the spot frees up for ' +
  'another member. ATP reserves the right to refuse entry if attendance compromises ' +
  'the safety of the group.';

/**
 * Never throws: if the CMS is unreachable we still show terms (the
 * generic fallback) rather than letting the member book with none.
 */
export async function getSessionTerms(): Promise<string> {
  try {
    const d: any = await api.get('/cms/sessions');
    const text = d?.content?.booking_terms?.terms_text;
    return (typeof text === 'string' && text.trim()) ? text : FALLBACK_TERMS;
  } catch {
    return FALLBACK_TERMS;
  }
}

// ── Blog hero (founder 2026-08-30: app and website must say the same
// thing — "The ATP Journal / Beyond the workout", not "Stories").
// Same source the website hydrates from (admin → CMS → Blog Page),
// same static fallbacks as blog.html. The title supports the web's
// <accent>…</accent> sentinel for the green word — parse client-side.
export interface BlogHero {
  eyebrow: string;
  title: string;   // may contain <accent>…</accent>
  sub: string;
}

const FALLBACK_BLOG_HERO: BlogHero = {
  eyebrow: 'The ATP Journal',
  title: 'Beyond the <accent>workout</accent>',
  sub: "Coach insights, member journeys, training breakdowns, and what's actually happening on the ground in Dubai, Al Ain and Muscat. Updated regularly.",
};

export async function getBlogHero(): Promise<BlogHero> {
  try {
    const d: any = await api.get('/cms/blog');
    const h = d?.content?.hero || {};
    return {
      eyebrow: (typeof h.eyebrow === 'string' && h.eyebrow.trim()) ? h.eyebrow : FALLBACK_BLOG_HERO.eyebrow,
      title:   (typeof h.title === 'string' && h.title.trim())     ? h.title   : FALLBACK_BLOG_HERO.title,
      sub:     (typeof h.sub === 'string' && h.sub.trim())         ? h.sub     : FALLBACK_BLOG_HERO.sub,
    };
  } catch {
    return FALLBACK_BLOG_HERO;
  }
}
