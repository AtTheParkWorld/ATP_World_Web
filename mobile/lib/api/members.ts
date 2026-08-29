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
  volleyball_level?: string | null;
  /** Canonical tribe FK — the edit-profile form prefills from this. */
  tribe_id?: string | number | null;
  residence_country?: string | null;
  residence_city?: string | null;
  profile_complete_pct: number | null;
  /** Unfilled completion fields, computed live by the backend. Empty when 100%. */
  profile_missing?: { field: string; label: string }[];
  points_balance: number;
  is_ambassador: boolean;
  /** Backend sends COALESCE(is_coach,false) — gates the Coach dashboard entry. */
  is_coach: boolean;
  /** COALESCE(referral_code, member_number) — always present. */
  referral_code: string;
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
  /** Always null today — the backend doesn't send grace-window hours
   *  (see getStreak mapping). Kept so the badge's guard keeps compiling. */
  hours_until_grace_ends?: number | null;
}

/** REAL payload of GET /members/me/streak (services/streak.js
 *  getStreakSummary) — none of the StreakSummary field names above are
 *  what the server actually sends, so getStreak() maps them. */
interface StreakSummaryWire {
  current: number;               // 0 once the grace window has lapsed
  longest: number;
  total_check_ins: number;
  last_check_in_at: string | null;
  first_check_in_at: string | null;
  weekly_avg_sessions: number;
  double_points_active: boolean;
  next_milestone: number;
  timezone: string;
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

export async function getProfile(): Promise<{ member: MemberProfile }> {
  // Wire shape matches MemberProfile except sessions_count /
  // referrals_count: they are SELECT COUNT(*) subqueries and node-pg
  // returns COUNT (bigint) as a STRING — coerce so the declared
  // `number` stays true for screens.
  type Wire = Omit<MemberProfile, 'sessions_count' | 'referrals_count'> & {
    sessions_count?: number | string;
    referrals_count?: number | string;
  };
  const res = await api.get<{ member: Wire }>('/members/profile');
  const m = res.member;
  return {
    member: {
      ...m,
      sessions_count: m.sessions_count != null ? Number(m.sessions_count) : undefined,
      referrals_count: m.referrals_count != null ? Number(m.referrals_count) : undefined,
    },
  };
}

export async function getStreak(): Promise<{ streak: StreakSummary }> {
  // Map the real payload (StreakSummaryWire) onto the shape every
  // screen + StreakBadge already consume. Before this mapping the
  // declared fields were simply absent (current_streak === undefined),
  // so the badge always showed "Start a streak".
  const res = await api.get<{ streak: StreakSummaryWire }>('/members/me/streak');
  const s = res.streak;
  const current = Number(s.current) || 0;
  return {
    streak: {
      current_streak: current,
      longest_streak: Number(s.longest) || 0,
      last_attended_at: s.last_check_in_at ?? null,
      // The server already zeroes `current` when the grace window has
      // lapsed (>1 day since last check-in in the member's timezone),
      // so "alive" is exactly current > 0.
      is_alive: current > 0,
      // BACKEND-GAP: no grace-window-hours field exists in the payload.
      hours_until_grace_ends: null,
    },
  };
}

export async function getStats(): Promise<{ stats: MemberStats }> {
  // Every field is a COUNT(*) / SUM() (except current_balance, an
  // INTEGER column) — pg returns the aggregates as STRINGS. Coerce all
  // so the declared `number`s stay true (Profile renders these tiles).
  type Wire = { [K in keyof MemberStats]: number | string };
  const res = await api.get<{ stats: Wire }>('/members/stats');
  const s = res.stats;
  return {
    stats: {
      total_sessions: Number(s.total_sessions) || 0,
      total_referrals: Number(s.total_referrals) || 0,
      total_points_earned: Number(s.total_points_earned) || 0,
      current_balance: Number(s.current_balance) || 0,
      challenges_completed: Number(s.challenges_completed) || 0,
      friends_count: Number(s.friends_count) || 0,
      ambassadors_referred: Number(s.ambassadors_referred) || 0,
    },
  };
}

export interface PatchProfileBody {
  first_name?: string;
  last_name?: string;
  phone?: string;
  date_of_birth?: string;
  gender?: string;
  nationality?: string;
  city_id?: string | number;
  country_id?: number;
  tribe_id?: string | number;
  sports_preferences?: string[];
  top_size?: string;
  bottom_size?: string;
  padel_level?: string;
  volleyball_level?: string;
  /** Residence — free text, any country/city (distinct from the
   *  operating-country FK that drives subscription pricing). */
  residence_country?: string;
  residence_city?: string;
}

export function patchProfile(body: PatchProfileBody): Promise<{ message: string }> {
  return api.patch('/members/profile', body);
}

export function patchAvatar(avatar_url: string): Promise<{ avatar_url: string }> {
  return api.patch('/members/avatar', { avatar_url });
}

// ── My Crew (referrals) ─────────────────────────────────────────
// Members who joined with your referral code. Mirrors the website's
// "My Crew" tab (GET /api/members/referrals).
export interface CrewMember {
  id: string | number;             // referral row id
  created_at: string;
  /** referrals.points_awarded is a BOOLEAN column ("signup bonus paid
   *  out yet") — NOT a point amount. Points live in points_from_member. */
  points_awarded: boolean;
  member_id: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  subscription_type: string | null;
  last_session_at: string | null;
  sessions_count: number | string; // pg COUNT comes back as string
  points_from_member: number | string;
}

/** The crew I belong to (whoever's code I signed up / joined with).
 *  Null until the member joins a crew; older deploys omit the key. */
export interface MyReferrer {
  id: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
}

export function getReferrals(): Promise<{ referrals: CrewMember[]; my_referrer?: MyReferrer | null }> {
  return api.get('/members/referrals');
}

/** Join someone's crew with their referral code (founder 2026-08-30).
 *  Server errors carry code CODE_NOT_FOUND | SELF_REFERRAL |
 *  ALREADY_IN_CREW with a human-readable message — surface it as-is. */
export function joinCrew(code: string): Promise<{ joined: boolean; referrer: MyReferrer }> {
  return api.post('/members/crew/join', { code });
}
