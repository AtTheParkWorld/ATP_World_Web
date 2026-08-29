/**
 * Sessions API — wraps /api/sessions, /api/cities, /api/activities,
 * and the tribe list under /api/sessions/tribes.
 *
 * Shapes mirror the columns returned by backend/src/routes/sessions.js
 * so screens can render straight from the API payload without a
 * decoder layer.
 */
import { api } from './client';

export interface Tribe {
  id: string;
  name: string;
  slug: string;
  color: string | null;
  description?: string | null;
}

export interface Activity {
  id: string;
  name: string;
  slug: string;
  icon?: string | null;
}

export interface City {
  id: string;
  name: string;
  country_id?: number | null;
}

export interface Session {
  id: string;
  name: string;
  description: string | null;
  scheduled_at: string;       // ISO
  ends_at: string | null;
  location: string | null;
  location_maps_url: string | null;
  session_type: 'free' | 'paid' | string;
  price: number | null;
  price_points: number | null;
  currency_code: string | null;
  capacity: number | null;
  points_reward: number | null;
  status: 'upcoming' | 'completed' | 'cancelled' | 'paused' | string;
  is_live_enabled: boolean;
  session_category: string | null;
  sport_type: string | null;
  city_id: string | null;
  coach_id: string | null;
  activity_id: string | null;
  tribe_id: string | null;
  intro_video_url: string | null;
  sponsor_name: string | null;
  sponsor_logo_url: string | null;
  sponsor_url: string | null;
  tribe_name: string | null;
  tribe_slug: string | null;
  tribe_color: string | null;
  activity_name: string | null;
  activity_slug: string | null;
  activity_icon: string | null;
  city_name: string | null;
  coach_first: string | null;
  coach_last: string | null;
  coach_avatar: string | null;
  coach_name: string | null;
  registrations_count: number;
  waitlist_count: number;
  // Private company sessions. The backend already gates visibility +
  // booking server-side (only that company's active employees ever see
  // these rows), so the client treats them as purely presentational.
  // NOTE: GET /api/sessions returns all four; GET /api/sessions/:id
  // currently only returns the two `sessions` columns (it selects s.*
  // without joining corporate_accounts), hence the optional company
  // name/logo — always render with a "Private session" fallback.
  is_corporate_only?: boolean;
  corporate_account_id?: string | null;
  corporate_company_name?: string | null;
  corporate_logo_url?: string | null;
  // Decorated by backend _decorateLiveStatus
  is_live_now?: boolean;
  minutes_until_start?: number;
  // Rolling member score across all sessions sharing the same name
  // (returned by both GET /sessions and GET /sessions/:id). avg comes
  // back as a numeric string ("4.5") or null when count is 0.
  series_rating_avg: string | null;
  series_rating_count: number;
}

export interface ListSessionsParams {
  city_id?: string;
  tribe?: string;
  tribe_id?: string;
  activity?: string;
  activity_id?: string;
  status?: 'upcoming' | 'completed' | 'cancelled';
  limit?: number;
  offset?: number;
}

export function listSessions(params: ListSessionsParams = {}): Promise<{ sessions: Session[] }> {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') q.set(k, String(v)); });
  const qs = q.toString();
  return api.get(`/sessions${qs ? `?${qs}` : ''}`);
}

export function getSession(id: string | number): Promise<{ session: Session }> {
  return api.get(`/sessions/${id}`);
}

/** One member's rating of a past run of this session series. */
export interface SessionFeedbackEntry {
  rating: number;
  comment: string | null;
  created_at: string;   // ISO — when the feedback was left
  first_name: string;
  session_at: string;   // ISO — when the rated session ran
}

export interface SessionFeedbackResponse {
  session_name: string;
  rating_avg: string | null;
  rating_count: number;
  feedback: SessionFeedbackEntry[];
}

/**
 * Member feedback for the session series (all sessions sharing this
 * session's name). GET /api/sessions/:id/feedback
 */
export function getSessionFeedback(id: string | number): Promise<SessionFeedbackResponse> {
  return api.get(`/sessions/${id}/feedback`);
}

export function listCities(): Promise<{ cities: City[] }> {
  return api.get('/cities');
}

export function listActivities(): Promise<{ activities: Activity[] }> {
  return api.get('/activities');
}

export function listTribes(): Promise<{ tribes: Tribe[] }> {
  return api.get('/sessions/tribes');
}

export interface Country {
  id: number;
  code: string;
  name: string;
  currency_code?: string | null;
}

/** Active countries — powers the "country I live in" picker. */
export function listCountries(): Promise<{ countries: Country[] }> {
  return api.get('/countries');
}

export interface SessionAttendee {
  id: string;
  first_name: string;
  last_name: string;
  avatar_url: string | null;
  tribe_name: string | null;
  tribe_slug: string | null;
  status: string;
  registered_at: string;
}

/** Who's going — members only, public-profile fields only. */
export function getSessionAttendees(id: string | number): Promise<{ attendees: SessionAttendee[]; total: number }> {
  return api.get(`/sessions/${id}/attendees`);
}
