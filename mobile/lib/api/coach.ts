/**
 * Coach-only API — for the coach dashboard.
 *
 * Covers: incoming message threads (visitor inquiries), reply,
 * coach-session offerings (1:1 booking offers), wallet/payouts.
 */
import { api } from './client';

export interface CoachThread {
  id: string;
  sender_name: string;
  sender_email: string;
  sender_phone: string | null;
  subject: string | null;
  public_token: string;
  created_at: string;
  last_message_at: string;
  coach_unread: number;
  visitor_unread: number;
  is_closed: boolean;
  message_count: number;
  last_message_preview: string | null;
  last_message_role: 'visitor' | 'coach' | 'admin' | null;
}

export interface CoachMessage {
  id: string;
  from_role: 'visitor' | 'coach' | 'admin';
  sender_name: string;
  sender_email: string;
  message: string;
  created_at: string;
}

export function listMyCoachThreads(coachId: string): Promise<{
  threads: CoachThread[];
  total: number;
  unread_threads: number;
  unread_messages: number;
}> {
  return api.get(`/coaches/${coachId}/threads`);
}

export function getCoachThread(coachId: string, threadId: string): Promise<{ thread: CoachThread; messages: CoachMessage[] }> {
  return api.get(`/coaches/${coachId}/threads/${threadId}`);
}

export function replyToCoachThread(coachId: string, threadId: string, message: string): Promise<{ ok: boolean }> {
  return api.post(`/coaches/${coachId}/threads/${threadId}/reply`, { message });
}

export interface CoachOffering {
  id: string;
  title: string;
  description: string | null;
  duration_mins: number;
  price_aed: number;
  max_participants: number;
  is_active: boolean;
}

export function listMyOfferings(): Promise<{ offerings: CoachOffering[] }> {
  return api.get('/coach-sessions/me/offerings');
}

export interface CoachWallet {
  balance_aed: number;
  pending_aed: number;
  paid_out_aed: number;
  recent_payouts: Array<{ id: string; amount_aed: number; status: string; created_at: string }>;
}

export function getMyWallet(): Promise<CoachWallet> {
  return api.get('/coach-sessions/wallet/me');
}
