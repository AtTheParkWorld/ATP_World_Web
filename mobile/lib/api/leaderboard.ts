/**
 * Leaderboard API — returns top-50 members ranked by points earned in
 * the selected window. Filters by city / tribe optional.
 *
 * Public endpoint, no auth required (so anonymous web visitors see it).
 */
import { api } from './client';

export interface LeaderboardRow {
  id: string;
  first_name: string;
  last_name: string;
  avatar_url: string | null;
  member_number: string;
  tribe_id: string | null;
  city_name: string | null;
  tribe_name: string | null;
  tribe_slug: string | null;
  tribe_color: string | null;
  current_streak: number;
  period_points: number | string;
}

export interface LeaderboardResponse {
  leaderboard: LeaderboardRow[];
  period: 'mtd' | 'ytd' | 'all-time' | string;
  tribe_id: string | null;
  city_id: string | null;
}

export function getLeaderboard(opts: { period?: 'mtd' | 'ytd' | 'all-time'; city_id?: string; tribe_id?: string } = {}):
  Promise<LeaderboardResponse> {
  const q = new URLSearchParams();
  Object.entries(opts).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') q.set(k, String(v)); });
  const qs = q.toString();
  return api.get(`/members/leaderboard${qs ? `?${qs}` : ''}`);
}
