/**
 * Public community stats — GET /stats/public, the same endpoint the
 * website hero reads for "We are X ATP members". No auth; the server
 * caches it for 60 s, so every sign-up (web or app) shows up within a
 * minute on both.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from './client';

export interface PublicStats {
  members_count: number;
  activities_count: number;
  sessions_this_month: number;
  cities_count: number;
  coaches_count: number;
  ambassadors_count: number;
  generated_at: string;
}

export function getPublicStats(): Promise<PublicStats> {
  return api.get('/stats/public');
}

/** 8214 → "8,214". Plain regex, not toLocaleString: the count must read
 *  the same on every phone, whatever its language / digit settings. */
export function formatCount(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Live member count, or null while loading / when the call fails — the
 *  caller hides the line rather than showing a wrong or zero number. */
export function useMemberCount(): number | null {
  const q = useQuery({
    queryKey: ['public-stats'],
    queryFn: getPublicStats,
    staleTime: 60 * 1000,
    retry: 1,
  });
  const n = q.data?.members_count;
  return typeof n === 'number' && n > 0 ? n : null;
}
