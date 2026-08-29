/**
 * Direct messages API — 1:1 conversations between members.
 *
 * The conversations table is symmetric: only one row per pair of
 * members (member_a < member_b). The endpoint always presents the
 * "other" member from the caller's perspective so screens can render
 * directly without juggling member_a/_b.
 */
import { api } from './client';
import { useAuthStore } from '@/lib/stores/auth.store';

export interface Conversation {
  id: string | number;
  last_message_at: string | null;
  last_message: string | null;
  other_id: string;
  other_first: string;
  other_last: string;
  other_avatar: string | null;
  unread_count: number | string;
}

export interface DirectMessage {
  id: string | number;
  content: string;
  created_at: string;
  read_at: string | null;
  sender_id: string;
  first_name: string;
  last_name: string;
  avatar_url: string | null;
}

export function listConversations(): Promise<{ conversations: Conversation[] }> {
  return api.get('/community/messages');
}

export function getThread(memberId: string): Promise<{ messages: DirectMessage[] }> {
  return api.get(`/community/messages/${memberId}`);
}

export async function sendMessage(memberId: string, content: string): Promise<{ message: DirectMessage }> {
  // 201 payload is { message: <messages RETURNING *> } — id,
  // conversation_id, sender_id, content, read_at, created_at. There is
  // no member join, so first_name / last_name / avatar_url are absent.
  // The sender IS the signed-in member — fill from the auth store so
  // the declared DirectMessage shape holds for optimistic renders
  // (today the thread screen invalidates + refetches).
  type Wire = Omit<DirectMessage, 'first_name' | 'last_name' | 'avatar_url'>;
  const res = await api.post<{ message: Wire }>(`/community/messages/${memberId}`, { content });
  const me = useAuthStore.getState().member;
  return {
    message: {
      ...res.message,
      first_name: me?.first_name ?? '',
      last_name: me?.last_name ?? '',
      avatar_url: me?.avatar_url ?? null,
    },
  };
}

// Real payload is { message: 'Message reported.' } — the previously
// declared { ok: boolean } was never sent by the backend.
export function reportMessage(messageId: string | number, reason: string): Promise<{ message: string }> {
  return api.post(`/community/messages/${messageId}/report`, { reason });
}
