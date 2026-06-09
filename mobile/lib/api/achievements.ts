/**
 * Achievements API — catalogue + member unlock state.
 *
 * Backend returns a single payload with the full catalogue annotated
 * with the calling member's progress, so one call drives the entire
 * Achievements screen.
 */
import { api } from './client';

export interface Achievement {
  id: number;
  name: string;
  description: string | null;
  icon: string | null;
  badge_image_url: string | null;
  points_reward: number;
  criteria_type: 'sessions' | 'streak' | 'referrals' | string;
  criteria_value: number;
  unlocked_at: string | null;
  points_credited: number | null;
  unlocked: boolean;
  progress: number;
  progress_pct: number;
}

export function getMyAchievements(): Promise<{
  achievements: Achievement[];
  stats: { sessions: number; streak: number; active_referrals: number };
  unlocked_count: number;
}> {
  return api.get('/achievements/me');
}
