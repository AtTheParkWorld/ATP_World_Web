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

export function listCoaches(): Promise<{ coaches: Coach[] }> {
  return api.get('/coaches');
}

export function getCoach(id: string): Promise<{ coach: Coach }> {
  return api.get(`/coaches/${id}`);
}
