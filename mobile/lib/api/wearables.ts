/**
 * Wearables API — Garmin / Strava / Fitbit connections + synced metrics.
 *
 * The OAuth dance happens in the system browser: getConnectUrl() returns
 * the provider's authorization URL (backend signs a state JWT so the
 * callback can attribute the grant), the app opens it via
 * WebBrowser.openAuthSessionAsync, and the backend callback page closes
 * itself when done. Re-fetch getMine() after the browser session ends.
 */
import { api } from './client';

export interface WearableConnection {
  id: string;
  provider: string;               // 'garmin' | 'strava' | 'fitbit' | ...
  provider_user_id: string | null;
  status: 'active' | 'error' | 'revoked' | string;
  last_sync_at: string | null;
  last_error: string | null;
  connected_at: string;
}

export interface WearableWorkout {
  id: string;
  provider: string;
  workout_type: string | null;
  started_at: string;
  duration_s: number | null;
  distance_m: number | null;
  calories: number | null;
  avg_hr: number | null;
  max_hr: number | null;
}

export interface WearableWeek {
  distance_m: number;
  duration_s: number;
  calories: number;
  workout_count: number;
}

export interface WearableProviderInfo {
  name: string;
  displayName: string;
  enabled: boolean;
}

export interface WearablesMe {
  connections: WearableConnection[];
  recent_workouts: WearableWorkout[];
  week: Partial<WearableWeek>;
  today: { steps?: number | null; distance_m?: number | null; active_calories?: number | null };
  consent: Record<string, unknown> | null;
  available: WearableProviderInfo[];
}

export function getMine(): Promise<WearablesMe> {
  return api.get('/wearables/me');
}

export function getConnectUrl(provider: string): Promise<{ redirect_url: string }> {
  return api.get(`/wearables/connect/${provider}`);
}

export function disconnect(provider: string): Promise<{ message: string }> {
  return api.post(`/wearables/disconnect/${provider}`);
}

export function syncNow(): Promise<{ synced?: number }> {
  return api.post('/wearables/sync');
}
