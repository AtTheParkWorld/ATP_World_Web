/**
 * In-app notifications — the same feed the bell badge counts.
 * Types seen in the wild: friend_request, streak_milestone,
 * session_feedback, session_reminder, points, generic.
 */
import { api } from './client';

export interface AppNotification {
  id: string | number;
  type: string;
  title: string | null;
  body: string | null;
  data: any;
  read_at: string | null;
  created_at: string;
}

export function listNotifications(limit = 30): Promise<{ notifications: AppNotification[]; unread_count: number }> {
  return api.get(`/notifications?limit=${limit}`);
}

export function markNotificationRead(id: string | number): Promise<any> {
  return api.patch(`/notifications/${id}/read`, {});
}

export function markAllNotificationsRead(): Promise<any> {
  return api.patch('/notifications/read-all', {});
}
