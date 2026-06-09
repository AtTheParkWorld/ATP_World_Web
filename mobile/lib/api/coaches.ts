/**
 * Coaches API — directory + per-coach detail.
 *
 * The list is heavily denormalized — backend's COACH_SELECT returns
 * everything we need to render a card without a second round-trip.
 */
import { api } from './client';

export interface Coach {
  id: string;
  first_name: string;
  last_name: string;
  avatar_url: string | null;
  city_name: string | null;
  slug: string | null;
  headline: string | null;
  bio: string | null;
  specialties: string[] | null;
  rating_avg: number | null;
  rating_count: number;
  is_featured: boolean;
  is_ambassador?: boolean;
  hero_url?: string | null;
  cover_url?: string | null;
  cert_badges?: string[] | null;
  social_instagram?: string | null;
  is_accepting_sessions?: boolean;
}

export function listCoaches(): Promise<{ coaches: Coach[] }> {
  return api.get('/coaches');
}

export function getCoach(id: string): Promise<{ coach: Coach }> {
  return api.get(`/coaches/${id}`);
}
