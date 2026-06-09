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
  id: number;
  name: string;
  slug: string;
  color: string | null;
  description?: string | null;
}

export interface Activity {
  id: number;
  name: string;
  slug: string;
  icon?: string | null;
}

export interface City {
  id: number;
  name: string;
  country_id?: number | null;
}

export interface Session {
  id: number;
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
  city_id: number | null;
  coach_id: number | null;
  activity_id: number | null;
  tribe_id: number | null;
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
  // Decorated by backend _decorateLiveStatus
  is_live_now?: boolean;
  minutes_until_start?: number;
}

export interface ListSessionsParams {
  city_id?: number;
  tribe?: string;
  tribe_id?: number;
  activity?: string;
  activity_id?: number;
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

export function getSession(id: number): Promise<{ session: Session }> {
  return api.get(`/sessions/${id}`);
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
