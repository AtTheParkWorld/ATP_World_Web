/**
 * Date helpers for ATP mobile. Backend stores all timestamps in UTC.
 * We render in the device's locale + 24h time (matches the web).
 *
 * Avoid date-fns to keep the bundle slim — these helpers are deliberately
 * tiny and cover only the formats screens need.
 */

const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad(n: number): string { return n < 10 ? '0' + n : '' + n; }

/** "Sat 12 Jun" */
export function dayHeader(iso: string): string {
  const d = new Date(iso);
  return `${SHORT_DAYS[d.getDay()]} ${d.getDate()} ${SHORT_MONTHS[d.getMonth()]}`;
}

/** "18:30" */
export function timeShort(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "Today", "Tomorrow", or weekday name. */
export function relativeDay(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((a.getTime() - b.getTime()) / 86_400_000);
  if (diff === 0)  return 'Today';
  if (diff === 1)  return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff < 7) return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];
  return dayHeader(iso);
}

/**
 * "in 25 min" / "in 3h" / "live" / "2 days ago"
 * Used for next-session card + Live badge timing copy.
 */
export function relativeStartLabel(iso: string): string {
  const d = new Date(iso).getTime();
  const now = Date.now();
  const min = Math.round((d - now) / 60_000);

  if (min >= 0 && min < 60)   return min === 0 ? 'starting now' : `in ${min} min`;
  if (min >= 60 && min < 60*24) return `in ${Math.round(min / 60)}h`;
  if (min >= 60*24)           return `in ${Math.round(min / (60*24))} days`;
  if (min < 0 && min > -60)   return `${Math.abs(min)} min ago`;
  if (min < 0)                return relativeDay(iso);
  return '';
}

/** Groups objects by their scheduled_at calendar day for SectionList. */
export function groupByDay<T extends { scheduled_at: string }>(items: T[]): { title: string; data: T[] }[] {
  const buckets = new Map<string, { title: string; data: T[] }>();
  for (const item of items) {
    const key = item.scheduled_at.slice(0, 10);
    if (!buckets.has(key)) buckets.set(key, { title: relativeDay(item.scheduled_at), data: [] });
    buckets.get(key)!.data.push(item);
  }
  return Array.from(buckets.values());
}
