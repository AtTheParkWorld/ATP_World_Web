/**
 * Coaches API — directory + per-coach detail.
 *
 * Backend response is nested: top-level member fields, plus profile{},
 * social{}, stats{} sub-objects. Mirroring that shape exactly so screens
 * just index in without a transform layer.
 */
import { api } from './client';

export interface CoachProfile {
  tagline:            string | null;
  bio:                string | null;
  philosophy:         string | null;
  cover_image_url:    string | null;
  profile_photo_url:  string | null;
  /** profile_photo_url, falling back to the member's avatar. */
  display_photo_url?: string | null;
  intro_video_url:    string | null;
  specialties:        string[] | null;
  certifications:     string[] | null;
  languages:          string[] | null;
  years_experience:   number | null;
  gallery_urls:       string[] | null;
  accepts_private_sessions: boolean;
  private_session_info: string | null;
  is_featured:        boolean;
}

export interface CoachSocial {
  instagram:    string | null;
  tiktok:       string | null;
  whatsapp_url: string | null;
  website_url:  string | null;
  youtube_url:  string | null;
  linkedin_url: string | null;
}

export interface CoachStats {
  rating_avg:          number;
  rating_count:        number;
  sessions_delivered:  number;
  total_sessions:      number | string;
  upcoming_sessions:   number | string;
}

export interface Coach {
  id:             string;
  member_number:  string;
  first_name:     string;
  last_name:      string;
  display_name:   string;
  slug:           string | null;
  city:           string | null;
  joined_at:      string;
  profile:        CoachProfile;
  social:         CoachSocial;
  stats:          CoachStats;
}

/** One feedback row on a coach. Author name comes flattened from the
 *  members join — first_name may be a visitor name with empty last_name. */
export interface CoachFeedback {
  id:         string;
  rating:     number;          // 1–5
  comment:    string | null;
  created_at: string;
  first_name: string;
  last_name:  string;
}

export interface CoachDetailResponse {
  coach:              Coach;
  feedback:           CoachFeedback[];
  upcoming_sessions?: unknown[];
}

export function listCoaches(): Promise<{ coaches: Coach[] }> {
  return api.get('/coaches');
}

export function getCoach(id: string): Promise<CoachDetailResponse> {
  return api.get(`/coaches/${id}`);
}

/** Submit a 1–5 star rating (+ optional comment ≤1000 chars). Re-rating
 *  the same coach UPDATES the member's previous rating server-side. */
export function rateCoach(id: string, input: { rating: number; comment?: string }): Promise<{ ok?: boolean }> {
  return api.post(`/coaches/${id}/feedback`, input);
}

/** Admin or the coach themself. Soft-delete: the comment disappears but
 *  the star score still counts toward the average. */
export function deleteCoachFeedback(coachId: string, feedbackId: string): Promise<{ ok?: boolean }> {
  return api.delete(`/coaches/${coachId}/feedback/${feedbackId}`);
}

/**
 * Update a coach profile (self or admin) — PUT /coaches/:id.
 *
 * IMPORTANT: the endpoint overwrites every field it accepts, so a
 * partial body blanks whatever it omits. Always send the complete
 * shape, seeded from the current profile.
 */
export interface CoachProfileUpdate {
  display_name?: string | null;
  tagline?: string | null;
  bio?: string | null;
  philosophy?: string | null;
  cover_image_url?: string | null;
  profile_photo_url?: string | null;
  intro_video_url?: string | null;
  specialties?: string[];
  certifications?: string[];
  languages?: string[];
  gallery_urls?: string[];
  accepts_private_sessions?: boolean;
  private_session_info?: string | null;
  instagram?: string | null;
  tiktok?: string | null;
  whatsapp_url?: string | null;
  website_url?: string | null;
  youtube_url?: string | null;
  linkedin_url?: string | null;
  years_experience?: number | null;
}

export function updateCoachProfile(id: string, body: CoachProfileUpdate): Promise<any> {
  return api.put(`/coaches/${id}`, body);
}
