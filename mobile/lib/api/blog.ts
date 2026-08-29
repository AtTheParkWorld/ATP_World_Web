/**
 * Blog API — public list + per-slug detail. Mirrors /api/blog routes.
 *
 * The server's shapePost() sends: id, slug, title, excerpt,
 * cover_image_url, body, category, tags, is_published, published_at,
 * created_at, updated_at, view_count, author{id,first_name,last_name}.
 * The old client type declared subtitle / hero_image_url / author_name /
 * author_avatar_url / reading_time_mins — NONE of which exist on the
 * wire. We keep those field names (screens render them behind guards)
 * but derive them client-side in shapeClientPost() so they're real.
 */
import { api } from './client';

export interface BlogAuthor {
  id: string | number | null;
  first_name: string;
  last_name: string | null;
}

export interface BlogPost {
  id: string | number;
  slug: string;
  title: string;
  /** Derived: no subtitle column exists — always null today. */
  subtitle: string | null;
  excerpt: string | null;
  body: string | null;
  category: string | null;
  cover_image_url: string | null;
  /** Derived: no hero_image_url column — mirrors cover_image_url. */
  hero_image_url: string | null;
  /** Derived from the nested author {first_name, last_name} object. */
  author_name: string | null;
  /** Derived: no avatar in the blog payload — always null today. */
  author_avatar_url: string | null;
  /** Derived client-side from body length (~200 wpm); the server has no
   *  reading-time column. Null when there's no body. */
  reading_time_mins: number | null;
  view_count: number;
  published_at: string | null;
  created_at: string;
  updated_at?: string | null;
  is_published: boolean;
  tags?: string[];
  author?: BlogAuthor | null;
}

/** Post exactly as the backend's shapePost() emits it. */
interface BlogPostWire {
  id: string | number;
  slug: string;
  title: string;
  excerpt: string | null;
  cover_image_url: string | null;
  body: string | null;
  category: string | null;
  tags: string[] | null;
  is_published: boolean;
  published_at: string | null;
  created_at: string;
  updated_at: string | null;
  view_count: number | string | null;
  author: BlogAuthor | null;
}

function shapeClientPost(p: BlogPostWire): BlogPost {
  const author = p.author || null;
  const authorName = author
    ? `${author.first_name || ''} ${author.last_name || ''}`.trim() || null
    : null;
  // ~200 words per minute, floor of 1 min for any non-empty body.
  const words = p.body ? String(p.body).split(/\s+/).filter(Boolean).length : 0;
  return {
    id:                p.id,
    slug:              p.slug,
    title:             p.title,
    subtitle:          null,
    excerpt:           p.excerpt ?? null,
    body:              p.body ?? null,
    category:          p.category ?? null,
    cover_image_url:   p.cover_image_url ?? null,
    hero_image_url:    p.cover_image_url ?? null,
    author_name:       authorName,
    author_avatar_url: null,
    reading_time_mins: words > 0 ? Math.max(1, Math.round(words / 200)) : null,
    view_count:        Number(p.view_count) || 0,
    published_at:      p.published_at ?? null,
    created_at:        p.created_at,
    updated_at:        p.updated_at ?? null,
    is_published:      !!p.is_published,
    tags:              p.tags || [],
    author,
  };
}

export async function listPosts(opts: { limit?: number; offset?: number; category?: string } = {}):
  Promise<{ posts: BlogPost[]; total: number }> {
  const q = new URLSearchParams();
  Object.entries(opts).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') q.set(k, String(v)); });
  const qs = q.toString();
  const r = await api.get<{ posts?: BlogPostWire[]; total?: number }>(`/blog${qs ? `?${qs}` : ''}`);
  return { posts: (r.posts || []).map(shapeClientPost), total: Number(r.total) || 0 };
}

export async function getPost(slug: string): Promise<{ post: BlogPost; related: BlogPost[] }> {
  const r = await api.get<{ post: BlogPostWire; related?: BlogPostWire[] }>(`/blog/${encodeURIComponent(slug)}`);
  return { post: shapeClientPost(r.post), related: (r.related || []).map(shapeClientPost) };
}

export function listCategories(): Promise<{ categories: Array<{ category: string; n: number }> }> {
  return api.get('/blog/categories');
}
