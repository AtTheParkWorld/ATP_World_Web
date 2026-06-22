/**
 * Blog API — public list + per-slug detail. Mirrors /api/blog routes.
 */
import { api } from './client';

export interface BlogPost {
  id: string | number;
  slug: string;
  title: string;
  subtitle: string | null;
  excerpt: string | null;
  body: string | null;
  category: string | null;
  cover_image_url: string | null;
  hero_image_url: string | null;
  author_name: string | null;
  author_avatar_url: string | null;
  reading_time_mins: number | null;
  view_count: number | null;
  published_at: string | null;
  created_at: string;
  is_published: boolean;
}

export function listPosts(opts: { limit?: number; offset?: number; category?: string } = {}):
  Promise<{ posts: BlogPost[]; total: number }> {
  const q = new URLSearchParams();
  Object.entries(opts).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') q.set(k, String(v)); });
  const qs = q.toString();
  return api.get(`/blog${qs ? `?${qs}` : ''}`);
}

export function getPost(slug: string): Promise<{ post: BlogPost; related: BlogPost[] }> {
  return api.get(`/blog/${encodeURIComponent(slug)}`);
}

export function listCategories(): Promise<{ categories: Array<{ category: string; n: number }> }> {
  return api.get('/blog/categories');
}
