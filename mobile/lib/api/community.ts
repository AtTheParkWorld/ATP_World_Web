/**
 * Community API — feed, posts, comments, reports.
 *
 * Pagination is keyset-based: pass `before` (ISO timestamp of the
 * oldest visible post) to load the next page. The screen tracks
 * before locally — no offset → no skew when new posts arrive.
 */
import { api } from './client';

export interface Post {
  id: string | number;
  content: string;
  media: Array<{ src: string; type?: string }> | null;
  likes_count: number;
  comments_count: number;
  created_at: string;
  liked_by_me: boolean;
  member_id: string;
  first_name: string;
  last_name: string;
  avatar_url: string | null;
  member_number?: string;
  is_ambassador?: boolean;
  tribe_id?: number | null;
  tribe_name?: string | null;
  tribe_slug?: string | null;
  tribe_color?: string | null;
}

export interface Comment {
  id: string | number;
  post_id: string | number;
  member_id: string;
  content: string;
  created_at: string;
  first_name: string;
  last_name: string;
  avatar_url: string | null;
  is_deleted?: boolean;
}

export interface FeedParams {
  before?: string;
  limit?: number;
  tribe?: 'mine';
  tribe_id?: number;
}

export function getFeed(params: FeedParams = {}): Promise<{ posts: Post[] }> {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') q.set(k, String(v)); });
  const qs = q.toString();
  return api.get(`/community/feed${qs ? `?${qs}` : ''}`);
}

export function getMyPosts(limit = 20): Promise<{ posts: Post[] }> {
  return api.get(`/community/me/posts?limit=${limit}`);
}

export function createPost(content: string, media: Array<{ src: string; type?: string }> = []): Promise<{ post: Post }> {
  return api.post('/community/posts', { content, media });
}

export function deletePost(postId: number): Promise<void> {
  return api.delete(`/community/posts/${postId}`);
}

export function toggleLike(postId: number): Promise<{ liked: boolean }> {
  return api.post(`/community/posts/${postId}/like`);
}

export function getComments(postId: number): Promise<{ comments: Comment[] }> {
  return api.get(`/community/posts/${postId}/comments`);
}

export function createComment(postId: number, content: string): Promise<{ comment: Comment }> {
  return api.post(`/community/posts/${postId}/comments`, { content });
}

export function deleteComment(postId: number, commentId: number): Promise<void> {
  return api.delete(`/community/posts/${postId}/comments/${commentId}`);
}

export function reportPost(postId: number, reason: string): Promise<{ message: string }> {
  return api.post(`/community/posts/${postId}/report`, { reason });
}

export function reportComment(commentId: number, reason: string): Promise<{ message: string }> {
  return api.post(`/community/comments/${commentId}/report`, { reason });
}
