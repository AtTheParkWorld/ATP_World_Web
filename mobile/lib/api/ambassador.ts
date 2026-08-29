/**
 * Ambassador API — endpoints only assigned ambassadors / coaches /
 * admins can hit. Used by the mobile Ambassador dashboard for
 * session attendance scanning + roster views.
 */
import { api } from './client';

export interface AttendanceRow {
  /** Mapped client-side from the row's `id` (the booking id) — the
   *  server never sends a `booking_id` field. The old phantom made every
   *  roster row's React key "undefined". */
  booking_id: string | number;
  member_id: string;
  member_number: string;
  first_name: string;
  last_name: string;
  avatar_url: string | null;
  status: 'confirmed' | 'attended' | string;
  checked_in_at: string | null;
  qr_token: string | null;
  check_in_method?: string | null;
  /** Joined server-side since 2026-08-30; null on older deploys
   *  (tribeColor() falls back to the default green). */
  tribe_name: string | null;
  tribe_slug: string | null;
}

/** Row as /sessions/:id/attendance sends it (id = booking id). */
type AttendanceWireRow = Omit<AttendanceRow, 'booking_id' | 'tribe_name' | 'tribe_slug'> & {
  id: string | number;
  tribe_name?: string | null;
  tribe_slug?: string | null;
};

export async function getAttendance(sessionId: string): Promise<{ attendance: AttendanceRow[] }> {
  const r = await api.get<{ attendance?: AttendanceWireRow[] }>(`/sessions/${sessionId}/attendance`);
  return {
    attendance: (r.attendance || []).map((row) => ({
      ...row,
      booking_id: row.id,
      tribe_name: row.tribe_name ?? null,
      tribe_slug: row.tribe_slug ?? null,
    })),
  };
}

/**
 * Real shape of POST /sessions/:id/checkin (see backend sessions.js):
 * { success, member: {first_name, last_name, member_number},
 *   checked_in_at, streak: <number>, double_points }.
 * The old type invented `ok`, `member.id`, `points_awarded` and a
 * nested streak object — none of which the server sends.
 */
export interface CheckinResponse {
  success: boolean;
  member: { first_name: string; last_name: string; member_number?: string };
  checked_in_at?: string;
  /** Current streak count — a plain number, not {current, longest}. */
  streak?: number;
  double_points?: boolean;
  /** BACKEND-GAP: never sent — check-in points are awarded when the
   *  session completes, so the scanner toast can't show them. */
  points_awarded?: number | null;
  /** Never sent on 200 — a duplicate scan surfaces as a thrown ApiError
   *  (409, code ALREADY_CHECKED_IN). */
  already_checked_in?: boolean;
}

export function checkInMember(sessionId: string, payload: { qr_token?: string; member_id?: string; method?: 'qr' | 'manual' }):
  Promise<CheckinResponse> {
  return api.post(`/sessions/${sessionId}/checkin`, { method: payload.method || (payload.qr_token ? 'qr' : 'manual'), ...payload });
}
