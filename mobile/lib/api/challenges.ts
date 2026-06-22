/**
 * Challenges API — list active challenges, join, view leaderboard
 * + per-challenge personal progress breakdown.
 */
import { api } from './client';

export interface Challenge {
  id: string | number;
  title: string;
  description: string | null;
  metric: string;
  device_metric: string | null;
  target: number;
  unit: string | null;
  starts_at: string;
  ends_at: string;
  status: 'active' | 'completed' | 'cancelled' | string;
  is_published: boolean;
  reward_points: number | null;
  cover_image_url: string | null;
  city_id: string | null;
  city_name: string | null;
  participant_count: number | string;
  my_progress: number | string;
  joined: boolean;
  requires_device?: boolean;
}

export interface ChallengeLeaderboardRow {
  rank: number | string;
  progress: number;
  completed: boolean;
  completed_at: string | null;
  joined_at: string;
  first_name: string;
  last_name: string;
  member_number: string;
  points_balance: number;
}

export function listChallenges(opts: { city_id?: string } = {}): Promise<{ challenges: Challenge[] }> {
  const q = new URLSearchParams();
  if (opts.city_id) q.set('city_id', opts.city_id);
  const qs = q.toString();
  return api.get(`/challenges${qs ? `?${qs}` : ''}`);
}

export function joinChallenge(id: string | number): Promise<{ ok: boolean; participant: any }> {
  return api.post(`/challenges/${id}/join`);
}

export function getMyProgress(id: string | number): Promise<{
  challenge: Challenge;
  joined: boolean;
  requires_device: boolean;
  recomputed: any;
  workouts_in_window: Array<{ id: string; provider: string; workout_type: string; started_at: string; duration_s: number; distance_m: number; calories: number }>;
}> {
  return api.get(`/challenges/${id}/my-progress`);
}

export function getChallengeLeaderboard(id: string | number): Promise<{ leaderboard: ChallengeLeaderboardRow[] }> {
  return api.get(`/challenges/${id}/leaderboard`);
}
