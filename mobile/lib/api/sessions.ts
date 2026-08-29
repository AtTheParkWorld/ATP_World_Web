/**
 * Sessions API — wraps /api/sessions, /api/cities, /api/activities,
 * and the tribe list under /api/sessions/tribes.
 *
 * Shapes mirror the columns returned by backend/src/routes/sessions.js.
 * Where the wire payload differs from what screens want (pg COUNT(*)
 * comes back as a string; the detail endpoint omits the coach aliases
 * the list endpoint has), the client functions below normalise it —
 * see mapSession(). Verified against the live API 2026-08-30.
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

// Real payload of GET /api/cities: { id, name, country } — country is
// the country NAME string (e.g. "UAE", "Oman"), grouped/ordered by it.
// There is no country_id column on this endpoint (audit 2026-08-30:
// the previously declared `country_id` was never sent).
export interface City {
  id: string;
  name: string;
  country: string;
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
  // sessions.price is DECIMAL(10,2) — node-postgres serialises it as a
  // STRING (live API returns e.g. "0.00"). Kept as-is (screens only
  // template it); wrap in Number() before doing math with it.
  price: number | string | null;
  price_points: number | null;
  currency_code: string | null;
  capacity: number | null;
  points_reward: number | null;
  // Stored enum is upcoming|completed|cancelled; the backend's
  // _decorateLiveStatus rewrites it to 'live' at read time while the
  // schedule window is open.
  status: 'upcoming' | 'live' | 'completed' | 'cancelled' | 'paused' | string;
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
  // Both endpoints send these since 2026-08-30 (detail gained them in
  // the audit); mapSession() still derives coach_name from
  // coach_first/coach_last as a fallback for older deploys.
  coach_avatar: string | null;
  coach_name: string | null;
  // COUNT(*) subselects arrive as strings on the wire ("2"); coerced
  // to numbers in mapSession() because screens do >=, division, etc.
  registrations_count: number;
  waitlist_count: number;
  // Detail endpoint only (GET /sessions/:id): attended bookings count
  // + this occurrence's own AVG(rating)::numeric(3,1) (string | null).
  attended_count?: number;
  avg_rating?: string | null;
  // Private company sessions. The backend gates visibility + booking
  // server-side (only that company's active employees ever see these
  // rows), so the client treats them as purely presentational. Both
  // GET /sessions and GET /sessions/:id now join corporate_accounts
  // and return all four fields (verified live 2026-08-30) — the
  // optionality is kept for pre-migration NULL fallbacks only.
  is_corporate_only?: boolean;
  corporate_account_id?: string | null;
  corporate_company_name?: string | null;
  corporate_logo_url?: string | null;
  // Decorated by backend _decorateLiveStatus on BOTH list and detail:
  // true while scheduled_at <= now < ends_at (90-min default window).
  // (Audit 2026-08-30: replaces the phantom `is_live_now` /
  // `minutes_until_start` fields the backend never sent.)
  is_live: boolean;
  // Rolling member score across all sessions sharing the same name.
  // ONLY the list endpoint computes these (LATERAL join); the detail
  // endpoint does not — mapSession() defaults them to null/0 there.
  // avg comes back as a numeric string ("4.5") or null when count is 0.
  // BACKEND-GAP: GET /api/sessions/:id lacks the series-rating LATERAL,
  // so the detail screen's series chip can never show real data.
  series_rating_avg: string | null;
  series_rating_count: number;
}

// What actually crosses the wire before mapSession() normalises it.
type RawSession = Omit<
  Session,
  'registrations_count' | 'waitlist_count' | 'attended_count'
  | 'coach_name' | 'coach_avatar'
  | 'series_rating_avg' | 'series_rating_count'
> & {
  registrations_count: number | string;
  waitlist_count: number | string;
  attended_count?: number | string | null;      // detail only
  coach_name?: string | null;                    // list only
  coach_avatar?: string | null;                  // list only
  series_rating_avg?: string | null;             // list only
  series_rating_count?: number | string | null;  // list only
};

/**
 * Normalise one session row: coerce pg count strings to numbers,
 * derive the coach aliases the detail endpoint omits, and default the
 * list-only series fields so the shared Session type is honest for
 * both endpoints.
 */
function mapSession(raw: RawSession): Session {
  const derivedCoach = `${raw.coach_first || ''} ${raw.coach_last || ''}`.trim() || null;
  return {
    ...raw,
    registrations_count: Number(raw.registrations_count) || 0,
    waitlist_count:      Number(raw.waitlist_count) || 0,
    attended_count:      raw.attended_count == null ? undefined : Number(raw.attended_count) || 0,
    coach_name:          raw.coach_name ?? derivedCoach,
    coach_avatar:        raw.coach_avatar ?? null,
    series_rating_avg:   raw.series_rating_avg ?? null,
    series_rating_count: Number(raw.series_rating_count ?? 0) || 0,
  };
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
  return api.get<{ sessions: RawSession[] }>(`/sessions${qs ? `?${qs}` : ''}`)
    .then((r) => ({ sessions: r.sessions.map(mapSession) }));
}

/** Ambassadors assigned to a session (admin multi-select prefill). */
export interface AssignedAmbassador {
  ambassador_id: string;
  first_name: string;
  last_name: string;
  email: string;
}

/**
 * Real payload of GET /api/sessions/:id (verified live 2026-08-30):
 * { session, assigned_ambassadors, myBooking, myWaitlistPos }.
 * myBooking is only populated when authenticated and holding a booking.
 */
export interface GetSessionResponse {
  session: Session;
  assigned_ambassadors: AssignedAmbassador[];
  myBooking: { id: string; status: string; qr_token: string | null; checked_in_at: string | null } | null;
  myWaitlistPos: number | null;
}

export function getSession(id: string | number): Promise<GetSessionResponse> {
  return api.get<Omit<GetSessionResponse, 'session'> & { session: RawSession }>(`/sessions/${id}`)
    .then((r) => ({ ...r, session: mapSession(r.session) }));
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
