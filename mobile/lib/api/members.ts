/**
 * Members API — profile, streak, stats, points wallet.
 *
 * Profile & stats are read on Home + Profile; streak feeds the Home
 * badge. Anything that mutates the member (avatar update, profile
 * edit) lives here too so screens import one symbol per concern.
 */
import { api } from './client';

export interface MemberProfile {
  id: string | number;
  member_number: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  avatar_url: string | null;
  avatar_gallery?: string[] | null;
  date_of_birth: string | null;
  gender: string | null;
  nationality: string | null;
  city_id: string | null;
  city_name?: string | null;
  subscription_type: string | null;
  sports_preferences?: string[] | null;
  top_size: string | null;
  bottom_size: string | null;
  padel_level: string | null;
  profile_complete_pct: number | null;
  points_balance: number;
  is_ambassador: boolean;
  joined_at: string;
  email_verified: boolean;
  sessions_count?: number;
  referrals_count?: number;
}

export interface StreakSummary {
  current_streak: number;
  longest_streak: number;
  last_attended_at: string | null;
  is_alive: boolean;             // false if the streak grace window has expired
  hours_until_grace_ends?: number | null;
}

export interface MemberStats {
  total_sessions: number;
  total_referrals: number;
  total_points_earned: number;
  current_balance: number;
  challenges_completed: number;
  friends_count: number;
  ambassadors_referred: number;
}

export function getProfile(): Promise<{ member: MemberProfile }> {
  return api.get('/members/profile');
}

export function getStreak(): Promise<{ streak: StreakSummary }> {
  return api.get('/members/me/streak');
}

export function getStats(): Promise<{ stats: MemberStats }> {
  return api.get('/members/stats');
}

export interface PatchProfileBody {
  first_name?: string;
  last_name?: string;
  phone?: string;
  date_of_birth?: string;
  gender?: string;
  nationality?: string;
  city_id?: number;
  country_id?: number;
  tribe_id?: number;
  sports_preferences?: string[];
  top_size?: string;
  bottom_size?: string;
  padel_level?: string;
  volleyball_level?: string;
}

export function patchProfile(body: PatchProfileBody): Promise<{ message: string }> {
  return api.patch('/members/profile', body);
}

export function patchAvatar(avatar_url: string): Promise<{ avatar_url: string }> {
  return api.patch('/members/avatar', { avatar_url });
}
