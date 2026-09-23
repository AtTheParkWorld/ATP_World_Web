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

// ── Our Story (founder 2026-09-23: "no place to tell our story" in
// the app). Same CMS section the website's homepage story block reads
// (admin → CMS → Home → Story), with the site's current copy as the
// built-in fallback so the screen is never blank — identical pattern
// to the blog hero.
export interface StoryContent {
  title: string;
  body: string;
  founder_photo: string | null;
  quote: string;
  quote_attrib: string;
  milestones: Array<{ year: string; event: string }>;
}

const FALLBACK_STORY: StoryContent = {
  title: 'Why we started At The Park',
  body:
    'It started with a simple sentence. "Let\'s meet at the park after work."\n\n' +
    'No website. No logo. No plan. Just Fredy and Tatiana — two people who believed ' +
    "that movement shouldn't cost a thing, and that the hardest part of fitness isn't " +
    "the workout. It's doing it alone.\n\n" +
    'What began at Al Formal Park in Abu Dhabi in 2015 with five colleagues is now the ' +
    "UAE's largest free outdoor fitness community — 7,000+ registered members across " +
    'Dubai, Al Ain and Muscat.',
  founder_photo: null,
  quote: "We didn't build a community. We just kept showing up. And so did everyone else.",
  quote_attrib: 'Fredy & Tatiana, founders',
  milestones: [
    { year: '2015', event: 'Founded at Al Formal Park, Abu Dhabi' },
    { year: '2017', event: 'Expanded to Dubai' },
    { year: '2023', event: 'Expanded to Muscat & Al Ain' },
    { year: '2026', event: '7,000+ members' },
  ],
};

export async function getStoryContent(): Promise<StoryContent> {
  try {
    const d: any = await api.get('/cms/index');
    const s = d?.content?.story || {};
    const str = (v: any, fb: string) =>
      typeof v === 'string' && v.trim() ? v : fb;
    return {
      title: str(s.title, FALLBACK_STORY.title),
      body: str(s.body, FALLBACK_STORY.body),
      founder_photo:
        typeof s.founder_photo === 'string' && s.founder_photo.trim()
          ? s.founder_photo
          : null,
      quote: str(s.quote, FALLBACK_STORY.quote),
      quote_attrib: str(s.quote_attrib, FALLBACK_STORY.quote_attrib),
      milestones: FALLBACK_STORY.milestones,
    };
  } catch {
    return FALLBACK_STORY;
  }
}
