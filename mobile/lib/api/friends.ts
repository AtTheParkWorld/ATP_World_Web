/**
 * Friends + block list + member search — wraps the /api/members
 * social endpoints.
 *
 * Friendship lifecycle (matches backend friendships.status enum):
 *   pending  → either party sent a request, the addressee can accept/decline
 *   accepted → both sides see each other in their friends list
 *   blocked  → hides the blocked party from feed / search / DMs
 *
 * The :id used by patch/delete is the friendship row id (returned by
 * listFriends), NOT the other member's id.
 */
import { api } from './client';

export interface Friendship {
  id: string | number;
  status: 'pending' | 'accepted' | 'blocked';
  created_at: string;
  friend_id: string;
  first_name: string;
  last_name: string;
  avatar_url: string | null;
  tribe_name: string | null;
  tribe_slug: string | null;
  tribe_color: string | null;
  /** Whether the current user was the original requester (so we
   * can show "Sent" vs "Pending your reply" in the UI). */
  requester_id: string;
}

export interface MemberSummary {
  id: string;
  first_name: string;
  last_name: string;
  avatar_url: string | null;
  tribe?: string | null;
  city_name?: string | null;
}

export function listFriends(): Promise<{ friendships: Friendship[] }> {
  return api.get('/members/friends');
}

export function sendFriendRequest(targetId: string): Promise<{ message: string; created: boolean }> {
  return api.post('/members/friends/request', { target_id: targetId });
}

export function respondToRequest(friendshipId: number, status: 'accepted' | 'declined'): Promise<{ message: string }> {
  return api.patch(`/members/friends/${friendshipId}`, { status });
}

export function unfriend(friendshipOrMemberId: string | number): Promise<{ removed: number }> {
  return api.delete(`/members/friends/${friendshipOrMemberId}`);
}

export function blockMember(targetId: string): Promise<{ blocked_id: string }> {
  return api.post(`/members/block/${targetId}`);
}

export function unblockMember(targetId: string): Promise<{ removed: number }> {
  return api.delete(`/members/block/${targetId}`);
}

export function listBlocked(): Promise<{ blocked: Array<{ id: string; first_name: string; last_name: string; avatar_url: string | null }> }> {
  return api.get('/members/blocked');
}

export function searchMembers(q: string, limit = 10): Promise<{ members: MemberSummary[] }> {
  if (!q || q.length < 2) return Promise.resolve({ members: [] });
  return api.get(`/members/search?q=${encodeURIComponent(q)}&limit=${limit}`);
}

export function reportMember(targetId: string, reason: string): Promise<{ message: string }> {
  return api.post(`/members/${targetId}/report`, { reason });
}
