/**
 * Community API — feed, posts, comments, reports.
 *
 * Pagination is keyset-based: pass `before` (ISO timestamp of the
 * oldest visible post) to load the next page. The screen tracks
 * before locally — no offset → no skew when new posts arrive.
 */
import { api } from './client';
import { useAuthStore } from '@/lib/stores/auth.store';

export interface TaggedMember {
  id: string;
  first_name: string;
  last_name: string;
}

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
  /** Friends the poster tagged — renders as a "with @Name" line. */
  tagged_members?: TaggedMember[] | null;
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

export async function createPost(
  content: string,
  media: Array<{ src: string; type?: string }> = [],
  taggedMemberIds: string[] = [],
): Promise<{ post: Post }> {
  const body: Record<string, unknown> = { content, media };
  if (taggedMemberIds.length) body.tagged_member_ids = taggedMemberIds;
  // 201 payload is { post: <posts RETURNING *> + tagged_members } — the
  // raw row has NO author join, so first_name / last_name / avatar_url
  // / liked_by_me are absent. Fill them from the signed-in member so
  // the declared Post shape holds if a screen ever renders the result
  // directly (today compose.tsx invalidates + refetches the feed).
  type Wire = Omit<Post, 'first_name' | 'last_name' | 'avatar_url' | 'liked_by_me'>;
  const res = await api.post<{ post: Wire }>('/community/posts', body);
  const me = useAuthStore.getState().member;
  return {
    post: {
      ...res.post,
      first_name: me?.first_name ?? '',
      last_name: me?.last_name ?? '',
      avatar_url: me?.avatar_url ?? null,
      liked_by_me: false, // you can't have liked a post that didn't exist
    },
  };
}

export function deletePost(postId: number): Promise<void> {
  return api.delete(`/community/posts/${postId}`);
}

export function toggleLike(postId: string | number): Promise<{ liked: boolean }> {
  return api.post(`/community/posts/${postId}/like`);
}

export async function getComments(postId: string | number): Promise<{ comments: Comment[] }> {
  // Real rows: id, content, likes_count, parent_id, created_at,
  // member_id, first_name, last_name, avatar_url — the SELECT never
  // includes post_id, so stamp the argument in to keep Comment.post_id
  // truthful.
  const res = await api.get<{ comments: Array<Omit<Comment, 'post_id'>> }>(
    `/community/posts/${postId}/comments`
  );
  return { comments: res.comments.map((c) => ({ ...c, post_id: postId })) };
}

export async function createComment(postId: string | number, content: string): Promise<{ comment: Comment }> {
  // 201 payload is { comment: <comments RETURNING *> } — id, post_id,
  // member_id, parent_id, content, likes_count, is_deleted, created_at.
  // No author join: fill first_name / last_name / avatar_url from the
  // signed-in member (the commenter IS the signed-in member) so the
  // declared Comment shape holds for optimistic renders.
  type Wire = Omit<Comment, 'first_name' | 'last_name' | 'avatar_url'>;
  const res = await api.post<{ comment: Wire }>(`/community/posts/${postId}/comments`, { content });
  const me = useAuthStore.getState().member;
  return {
    comment: {
      ...res.comment,
      first_name: me?.first_name ?? '',
      last_name: me?.last_name ?? '',
      avatar_url: me?.avatar_url ?? null,
    },
  };
}

export function deleteComment(postId: string | number, commentId: string | number): Promise<void> {
  return api.delete(`/community/posts/${postId}/comments/${commentId}`);
}

export function reportPost(postId: string | number, reason: string): Promise<{ message: string }> {
  return api.post(`/community/posts/${postId}/report`, { reason });
}

export function reportComment(commentId: number, reason: string): Promise<{ message: string }> {
  return api.post(`/community/comments/${commentId}/report`, { reason });
}
