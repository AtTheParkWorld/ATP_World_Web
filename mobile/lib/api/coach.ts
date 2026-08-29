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
  /** Backend stores visitor-sent messages with from_role='member'
   *  (never 'visitor') — see coach_messages inserts in
   *  backend/src/routes/coaches.js. */
  last_message_role: 'member' | 'coach' | 'admin' | null;
}

export interface CoachMessage {
  id: string;
  /** 'member' = the visitor side (even for anonymous visitors). */
  from_role: 'member' | 'coach' | 'admin';
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

export function replyToCoachThread(coachId: string, threadId: string, message: string): Promise<{ success: boolean }> {
  return api.post(`/coaches/${coachId}/threads/${threadId}/reply`, { message });
}

/**
 * Row from coach_offerings (SELECT * on the backend). The column is
 * `duration_min` (not `duration_mins`), and the table has NO
 * max_participants column — 1:1 offerings are single-participant.
 */
export interface CoachOffering {
  id: string;
  title: string;
  description: string | null;
  duration_min: number;
  price_aed: number;
  is_active: boolean;
  sort_order?: number;
  created_at?: string;
  updated_at?: string;
}

export function listMyOfferings(): Promise<{ offerings: CoachOffering[] }> {
  return api.get('/coach-sessions/me/offerings');
}

/**
 * Wallet shape as the API ACTUALLY returns it (founder crash
 * 2026-09-19): GET /coach-sessions/wallet/me responds with
 * `{ wallet: { balance_aed, pending_aed }, transactions,
 * coach_earnings_this_month }` — the balance is NESTED. The client
 * previously typed it as a flat object, so `data.balance_aed` was
 * undefined and `.toLocaleString()` on it crashed the coach dashboard.
 * `paid_out_aed` and `recent_payouts` never existed at all.
 *
 * We flatten here so both screens keep the shape they already use, and
 * coerce numerics — Postgres returns numeric columns as strings.
 */
export interface CoachWalletTxn {
  id: string;
  amount_aed: number;
  balance_after: number | null;
  txn_type: string | null;
  description: string | null;
  created_at: string;
}

export interface CoachWallet {
  balance_aed: number;
  pending_aed: number;
  /** Derived: total credited historically (no API field for it). */
  paid_out_aed: number;
  transactions: CoachWalletTxn[];
  /** Kept for the wallet screen's payout list — transactions serve it. */
  recent_payouts: CoachWalletTxn[];
  coach_earnings_this_month: { session_count: number; gross_aed: number; cancellation_aed: number } | null;
}

export async function getMyWallet(): Promise<CoachWallet> {
  const r: any = await api.get('/coach-sessions/wallet/me');
  const w = r?.wallet || {};
  const txns: CoachWalletTxn[] = Array.isArray(r?.transactions) ? r.transactions : [];
  const paidOut = txns
    .filter((t) => (t.txn_type || '').toLowerCase().includes('payout'))
    .reduce((sum, t) => sum + Math.abs(Number(t.amount_aed) || 0), 0);
  return {
    balance_aed: Number(w.balance_aed) || 0,
    pending_aed: Number(w.pending_aed) || 0,
    paid_out_aed: paidOut,
    transactions: txns,
    recent_payouts: txns.filter((t) => (t.txn_type || '').toLowerCase().includes('payout')).slice(0, 10),
    coach_earnings_this_month: r?.coach_earnings_this_month || null,
  };
}
