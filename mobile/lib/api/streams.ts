/**
 * Live streams API. The MVP backend uses HLS via short-chunk uploads
 * pinned to R2; on the mobile side we play back via the m3u8 URL the
 * backend computes from chunks.
 */
import { api } from './client';

export interface LiveStream {
  id: string;
  title: string;
  description: string | null;
  stream_type: 'session' | 'shoutout' | 'coach' | string;
  tier_required: 'free' | 'premium' | 'premium_plus' | string;
  started_at: string;
  peak_viewers: number;
  host_member_id: string;
  session_id: string | null;
  session_name: string | null;
  session_location: string | null;
  first_name: string;
  last_name: string;
  avatar_url: string | null;
  host_photo: string | null;
  host_role: 'coach' | 'ambassador' | 'member';
  concurrent_viewers: number;
  can_view: boolean;
  is_locked: boolean;
}

export interface StreamPlayback {
  hls_url: string | null;
  poster_url: string | null;
  is_live: boolean;
}

export function listLiveStreams(): Promise<{ streams: LiveStream[] }> {
  return api.get('/streams/live');
}

export function trackView(streamId: string): Promise<{ ok: boolean; playback?: StreamPlayback }> {
  return api.post(`/streams/${streamId}/view`);
}
