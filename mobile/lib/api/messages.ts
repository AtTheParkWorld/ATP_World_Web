/**
 * Direct messages API — 1:1 conversations between members.
 *
 * The conversations table is symmetric: only one row per pair of
 * members (member_a < member_b). The endpoint always presents the
 * "other" member from the caller's perspective so screens can render
 * directly without juggling member_a/_b.
 */
import { api } from './client';

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

export function sendMessage(memberId: string, content: string): Promise<{ message: DirectMessage }> {
  return api.post(`/community/messages/${memberId}`, { content });
}

export function reportMessage(messageId: string | number, reason: string): Promise<{ ok: boolean }> {
  return api.post(`/community/messages/${messageId}/report`, { reason });
}
