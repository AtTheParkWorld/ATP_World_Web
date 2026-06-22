/**
 * Ambassador API — endpoints only assigned ambassadors / coaches /
 * admins can hit. Used by the mobile Ambassador dashboard for
 * session attendance scanning + roster views.
 */
import { api } from './client';

export interface AttendanceRow {
  booking_id: string | number;
  member_id: string;
  member_number: string;
  first_name: string;
  last_name: string;
  avatar_url: string | null;
  status: 'confirmed' | 'attended' | 'cancelled' | string;
  checked_in_at: string | null;
  qr_token: string | null;
  tribe_name: string | null;
  tribe_slug: string | null;
}

export function getAttendance(sessionId: string): Promise<{ attendance: AttendanceRow[] }> {
  return api.get(`/sessions/${sessionId}/attendance`);
}

export interface CheckinResponse {
  ok: boolean;
  member: { id: string; first_name: string; last_name: string };
  points_awarded: number | null;
  streak: { current: number; longest: number } | null;
  already_checked_in?: boolean;
}

export function checkInMember(sessionId: string, payload: { qr_token?: string; member_id?: string; method?: 'qr' | 'manual' }):
  Promise<CheckinResponse> {
  return api.post(`/sessions/${sessionId}/checkin`, { method: payload.method || (payload.qr_token ? 'qr' : 'manual'), ...payload });
}
