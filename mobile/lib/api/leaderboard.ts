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
  // On the wire this is a pg SUM(...) STRING (live API sends e.g.
  // "100") — coerced to a number in getLeaderboard().
  period_points: number;
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
  // Backend members.js /leaderboard: period_points comes from
  // COALESCE(SUM(pl.amount) FILTER (...), 0) → string. The
  // pre-migration fallback branch also drops current_streak and the
  // tribe columns entirely, so they're defaulted here.
  type RawRow = Omit<LeaderboardRow, 'period_points' | 'current_streak' | 'tribe_name' | 'tribe_slug' | 'tribe_color'> & {
    period_points: number | string;
    current_streak?: number | null;
    tribe_name?: string | null;
    tribe_slug?: string | null;
    tribe_color?: string | null;
  };
  return api.get<Omit<LeaderboardResponse, 'leaderboard'> & { leaderboard: RawRow[] }>(
    `/members/leaderboard${qs ? `?${qs}` : ''}`
  ).then((r) => ({
    ...r,
    leaderboard: r.leaderboard.map((row) => ({
      ...row,
      period_points:  Number(row.period_points) || 0,
      current_streak: Number(row.current_streak ?? 0) || 0,
      tribe_name:  row.tribe_name ?? null,
      tribe_slug:  row.tribe_slug ?? null,
      tribe_color: row.tribe_color ?? null,
    })),
  }));
}
