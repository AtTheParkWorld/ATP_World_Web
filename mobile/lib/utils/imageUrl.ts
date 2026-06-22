/**
 * Normalise an image URL coming back from the backend.
 *
 * Members + coaches store avatars three different ways depending on
 * when they were created:
 *   - relative API path:   "/api/cms/media/<uuid>"
 *   - relative public path: "/uploads/..."
 *   - full R2 URL:         "https://pub-....r2.dev/...."
 *
 * Mobile <Image> needs a fully-qualified URL or it shows nothing.
 * Prepend our backend origin when the URL is relative; pass full
 * URLs through untouched.
 */
import { API_BASE } from '@/lib/api/client';

// API_BASE looks like "https://atp-world-web.onrender.com/api"; strip
// the trailing "/api" so a path that already begins with "/api/cms/..."
// resolves cleanly.
const ORIGIN = API_BASE.replace(/\/api\/?$/, '');

export function absUrl(maybeRelative: string | null | undefined): string | null {
  if (!maybeRelative) return null;
  if (/^https?:\/\//i.test(maybeRelative)) return maybeRelative;
  if (maybeRelative.startsWith('/')) return ORIGIN + maybeRelative;
  return ORIGIN + '/' + maybeRelative;
}
