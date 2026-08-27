/**
 * Sponsor promo banner (founder 2026-08-30) — one admin-managed
 * pop-up (image or video) shown once per app open. Impressions and
 * clicks are counted server-side for sponsor reporting.
 */
import { api } from './client';

export interface PromoBanner {
  id: string;
  title: string | null;
  type: 'image' | 'video';
  media_url: string;
  link_url: string | null;
}

export function getActivePromo(): Promise<{ banner: PromoBanner | null }> {
  return api.get('/promos/active');
}

// Fire-and-forget — a failed counter must never surface to the member.
export function trackPromoImpression(id: string): void {
  api.post(`/promos/${id}/impression`, {}).catch(() => {});
}
export function trackPromoClick(id: string): void {
  api.post(`/promos/${id}/click`, {}).catch(() => {});
}
